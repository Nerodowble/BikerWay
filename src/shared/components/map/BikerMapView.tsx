import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Polyline, UrlTile } from 'react-native-maps';
import type {
  MapPressEvent,
  Region,
} from 'react-native-maps';
import type { GeoPosition } from '@/domains/navigation/types';
import type { RouteCoordinate } from '@/domains/routing/types';
import type { FilteredFuelPoi } from '@/domains/poi/geometry';
import type { FuelPoi } from '@/domains/poi/types';
import type { WeatherSegment } from '@/domains/weather/types';
import { colors } from '@/shared/theme';
import {
  OSM_DARK_TILE_TEMPLATE,
  OSM_TILE_TEMPLATE,
  TILE_ATTRIBUTION_DARK,
  TILE_ATTRIBUTION_LIGHT,
  resolveTileMode,
  type TileMode,
} from './MapTileConfig';
import { MotorcycleMarker } from './MotorcycleMarker';
import { DestinationMarker } from './DestinationMarker';
import { RoutePolyline } from './RoutePolyline';
import { AlternativeRoutePolyline } from './AlternativeRoutePolyline';
import { WeatherSegmentPolyline } from './WeatherSegmentPolyline';
import { PoiMarker } from './PoiMarker';
import { FuelWaypointMarker } from './FuelWaypointMarker';
import { PeerMemberMarker } from './PeerMemberMarker';
import { PeerLabelsOverlay } from './PeerLabelsOverlay';
import type { ComboioPeerPosition } from '@/state/voiceGroupStore';
import { CAMERA_CONFIG, type CameraMode } from './cameraConfig';
import { useMapCameraController } from './useMapCameraController';

export interface BikerMapViewProps {
  userPosition: GeoPosition | null;
  destination?: GeoPosition | null;
  routeCoordinates?: RouteCoordinate[];
  followUser?: boolean;
  mode?: CameraMode;
  /**
   * Tile rendering mode. Defaults to `'auto'` — light by day, dark by night
   * (using local device clock). Legacy `useDarkTiles` boolean is kept for
   * backward compat but ignored when `tileMode` is provided.
   */
  tileMode?: TileMode;
  useDarkTiles?: boolean;
  onMapPress?: (coordinate: RouteCoordinate) => void;
  initialRegion?: Region;
  children?: React.ReactNode;
  /**
   * Optional list of fuel POIs to render on the map. Each entry is rendered
   * as a {@link PoiMarker}. Pass `selectedPoiId` to visually highlight one of
   * them, and `onPoiPress` to receive tap events.
   */
  pois?: FilteredFuelPoi[];
  selectedPoiId?: string | null;
  onPoiPress?: (poi: FilteredFuelPoi) => void;
  /**
   * Active fuel detour waypoint. When provided, renders a large highlighted
   * marker (the {@link FuelWaypointMarker}) so the rider can see the
   * intermediate stop as a clearly-distinct pin from the destination + the
   * smaller PoiMarker shortlist dots.
   */
  fuelWaypoint?: FuelPoi | null;
  /**
   * Latest GPS positions of other comboio members. Rendered as one
   * {@link PeerMemberMarker} per entry. The screen is responsible for
   * pruning stale entries (see `purgeStalePeerPositions` in the voice
   * store); this prop just paints whatever it receives.
   */
  peerMembers?: ComboioPeerPosition[];
  /**
   * Optional list of OSRM route alternatives to display simultaneously
   * (Google Maps / Waze style picker). Each entry carries its own id (used
   * as the React key), coordinates, and stroke colour. The colour must
   * match the matching card in the {@link RouteAlternativesSheet}. The
   * `selectedAlternativeIndex` prop highlights the picked one with a
   * thicker stroke + higher zIndex.
   */
  routeAlternatives?: Array<{
    id: string;
    coordinates: RouteCoordinate[];
    color: string;
  }>;
  /**
   * Zero-based index into `routeAlternatives` for the highlighted entry.
   * Use -1 or leave undefined when no alternative is selected — every
   * polyline then renders at the base (thinner) width.
   */
  selectedAlternativeIndex?: number;
  /**
   * Per-trecho weather overlay for the ACTIVE route. Each entry is a
   * contiguous slice of the route polyline tagged with a severity bucket;
   * the map paints warning/danger slices as coloured polylines on top of
   * the base {@link RoutePolyline}. Pass undefined or [] to hide the
   * overlay entirely (e.g. before the first Open-Meteo response arrives).
   *
   * Render order is intentional: weather segments are drawn AFTER the base
   * route polyline (and after any alternatives) so they sit visually on top
   * — the rider should immediately see where bad weather hits the trip.
   */
  weatherSegments?: WeatherSegment[];
  /**
   * Optional catalog preview polyline. Painted in blue (distinct from the
   * orange active-route polyline) and the camera fits it on mount so the
   * rider sees the suggested route in full. Does NOT participate in
   * follow-user / navigation logic — it is a passive overlay cleared by
   * `setPreviewRoute(null)` on the catalog store.
   */
  previewPolyline?: Array<{ latitude: number; longitude: number }>;
  /**
   * Optional "approach" leg painted in orange (`colors.accent`). Used by
   * the catalog preview to show the OSRM trajectory from the rider's GPS
   * to the route start. Rendered alongside `previewPolyline` and the
   * camera fits both at once so the rider sees the entire trip envelope.
   */
  approachPolyline?: Array<{ latitude: number; longitude: number }>;
  testID?: string;
}

/**
 * Imperative API exposed via ref. Use sparingly — most camera state should
 * flow through `mode` and `followUser` props instead.
 */
export interface BikerMapHandle {
  /**
   * Force-animate the camera back to the rider's current GPS position using
   * the active camera mode's preset (zoom, pitch, heading). No-op when
   * userPosition is null.
   */
  centerOnUser: () => void;
}

const DEFAULT_REGION: Region = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

/**
 * BikerWay map surface.
 *
 * Tile strategy:
 *   - `provider={undefined}` selects the platform default. On Android this
 *     avoids requesting Google Maps (which needs an API key); on iOS it
 *     falls back to the Apple basemap, which is then visually covered by
 *     our `UrlTile` raster layer.
 *   - Tile choice (light vs dark) is driven by `tileMode` (default 'auto' —
 *     follows the device clock). Legacy `useDarkTiles` boolean still works.
 *
 * Camera follow:
 *   - Camera behavior is delegated to `useMapCameraController`. In `idle`
 *     mode the map is a calm top-down view; in `navigating` mode it becomes
 *     a Waze-style 3D follow camera with adaptive zoom, pitch, heading
 *     rotation, and a forward-shifted center so the rider sees the road
 *     ahead. The `followUser` prop is retained as a hard on/off switch.
 *   - A manual `centerOnUser()` method is exposed via ref so screens can
 *     wire up a "my location" FAB.
 */
export const BikerMapView = forwardRef<BikerMapHandle, BikerMapViewProps>(
  (
    {
      userPosition,
      destination,
      routeCoordinates,
      followUser = true,
      mode = 'idle',
      tileMode = 'auto',
      useDarkTiles,
      onMapPress,
      initialRegion,
      children,
      pois,
      selectedPoiId,
      onPoiPress,
      fuelWaypoint,
      peerMembers,
      routeAlternatives,
      selectedAlternativeIndex,
      weatherSegments,
      previewPolyline,
      approachPolyline,
      testID,
    },
    ref,
  ) => {
    const mapRef = useRef<MapView | null>(null);
    // Bumped on every map region change so `PeerLabelsOverlay` knows to
    // re-project its lat/lng to pixel coordinates. We use a counter (not the
    // region itself) so React shallow-compares cheaply.
    const [regionTick, setRegionTick] = useState(0);
    const handleRegionChange = useCallback(() => {
      setRegionTick((n) => n + 1);
    }, []);

    // Resolve tile + attribution from the new tileMode prop. If a caller still
    // passes the legacy `useDarkTiles` boolean, we honor it as an override.
    const resolved = (() => {
      if (typeof useDarkTiles === 'boolean') {
        return useDarkTiles
          ? {
              template: OSM_DARK_TILE_TEMPLATE,
              attribution: TILE_ATTRIBUTION_DARK,
              isDark: true,
            }
          : {
              template: OSM_TILE_TEMPLATE,
              attribution: TILE_ATTRIBUTION_LIGHT,
              isDark: false,
            };
      }
      return resolveTileMode(tileMode);
    })();
    const effectiveTileTemplate = resolved.template;
    const effectiveAttribution = resolved.attribution;

    useMapCameraController({
      mapRef,
      mode,
      userPosition,
      enabled: followUser,
    });

    // Camera fit for the catalog preview. We combine the approach (orange)
    // and main (blue) polylines into a single bounds rect so the rider
    // sees both legs at once, with the user position appended so the
    // current location is also inside the visible window. A cheap hash of
    // the first/last vertex of each polyline + the lengths acts as the
    // identity key — refits only when the actual geometry changes, not on
    // every unrelated parent re-render.
    function endpointHash(
      poly: Array<{ latitude: number; longitude: number }> | undefined,
    ): string {
      if (!poly || poly.length === 0) return '';
      const first = poly[0];
      const last = poly[poly.length - 1];
      if (!first || !last) return '';
      return `${first.latitude.toFixed(5)},${first.longitude.toFixed(5)}|${last.latitude.toFixed(5)},${last.longitude.toFixed(5)}|${poly.length}`;
    }
    const fitKey =
      previewPolyline || approachPolyline
        ? `${endpointHash(previewPolyline)}#${endpointHash(approachPolyline)}`
        : null;
    useEffect(() => {
      if (!mapRef.current) return;
      const coords: Array<{ latitude: number; longitude: number }> = [];
      if (approachPolyline && approachPolyline.length >= 2) {
        coords.push(...approachPolyline);
      }
      if (previewPolyline && previewPolyline.length >= 2) {
        coords.push(...previewPolyline);
      }
      if (coords.length < 2) return;
      if (userPosition) {
        coords.push({
          latitude: userPosition.latitude,
          longitude: userPosition.longitude,
        });
      }
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 120, right: 60, bottom: 240, left: 60 },
        animated: true,
      });
      // userPosition deliberately omitted from deps: we want a refit only
      // when the polylines themselves change, NOT on every GPS tick.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitKey]);

    useImperativeHandle(
      ref,
      () => ({
        centerOnUser: () => {
          if (!mapRef.current || !userPosition) return;
          const cfg = CAMERA_CONFIG[mode];
          const heading = cfg.headingFollowsUser
            ? userPosition.heading ?? 0
            : 0;
          mapRef.current.animateCamera(
            {
              center: {
                latitude: userPosition.latitude,
                longitude: userPosition.longitude,
              },
              zoom: cfg.zoom,
              pitch: cfg.pitch,
              heading,
            },
            { duration: 700 },
          );
        },
      }),
      [userPosition, mode],
    );

    const handlePress = useCallback(
      (event: MapPressEvent) => {
        if (!onMapPress) {
          return;
        }
        const { latitude, longitude } = event.nativeEvent.coordinate;
        onMapPress({ latitude, longitude });
      },
      [onMapPress],
    );

    return (
      <View style={styles.container} testID={testID}>
        <MapView
          ref={mapRef}
          provider={undefined}
          style={styles.map}
          initialRegion={initialRegion ?? DEFAULT_REGION}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass
          pitchEnabled={false}
          rotateEnabled
          loadingEnabled
          loadingBackgroundColor={colors.background}
          loadingIndicatorColor={colors.accent}
          onPress={handlePress}
          onRegionChange={handleRegionChange}
        >
          <UrlTile
            urlTemplate={effectiveTileTemplate}
            tileSize={256}
            maximumZ={19}
            zIndex={-1}
            shouldReplaceMapContent={false}
          />

          {userPosition ? <MotorcycleMarker position={userPosition} /> : null}

          {destination ? <DestinationMarker position={destination} /> : null}

          {routeCoordinates && routeCoordinates.length >= 2 ? (
            <RoutePolyline coordinates={routeCoordinates} />
          ) : null}

          {/*
           * Weather overlay sits between the base RoutePolyline and any
           * markers/POIs. Each entry is a sub-arc of the active route
           * polyline tagged with a severity bucket. 'ok' segments render
           * nothing (see WeatherSegmentPolyline) so we never duplicate the
           * base polyline pixels. The key includes both the segment index
           * AND its severity so React drops + remounts the polyline cleanly
           * when the segmentation changes (Open-Meteo refresh, reroute).
           */}
          {weatherSegments && weatherSegments.length > 0
            ? weatherSegments.map((seg, idx) => (
                <WeatherSegmentPolyline
                  key={`weather-${idx}-${seg.severity}`}
                  segment={seg}
                />
              ))
            : null}

          {routeAlternatives && routeAlternatives.length > 0
            ? (() => {
                // Render order matters: react-native-maps composites polylines
                // in the order they appear in the children array, so we push
                // the SELECTED alternative to the end of the list so it draws
                // on top of its siblings. The AlternativeRoutePolyline also
                // bumps its own zIndex on selection — belt-and-braces.
                const selIdx =
                  typeof selectedAlternativeIndex === 'number' &&
                  selectedAlternativeIndex >= 0 &&
                  selectedAlternativeIndex < routeAlternatives.length
                    ? selectedAlternativeIndex
                    : -1;
                const ordered =
                  selIdx >= 0
                    ? [
                        ...routeAlternatives.filter((_, i) => i !== selIdx),
                        routeAlternatives[selIdx] as (typeof routeAlternatives)[number],
                      ]
                    : routeAlternatives;
                return ordered.map((alt, renderIdx) => {
                  // Recover the original index so we can pass the correct
                  // `selected` flag (we cannot rely on renderIdx === selIdx
                  // after the reorder above).
                  const originalIdx = routeAlternatives.indexOf(alt);
                  const isSelected = originalIdx === selIdx;
                  return (
                    <AlternativeRoutePolyline
                      key={`alt-${alt.id}-${renderIdx}`}
                      coordinates={alt.coordinates}
                      color={alt.color}
                      selected={isSelected}
                    />
                  );
                });
              })()
            : null}

          {pois
            ? pois.map((poi) => (
                <PoiMarker
                  key={poi.id}
                  poi={poi}
                  selected={poi.id === selectedPoiId}
                  onPress={onPoiPress}
                />
              ))
            : null}

          {peerMembers
            ? peerMembers.map((peer) => (
                <PeerMemberMarker key={peer.id} position={peer} />
              ))
            : null}

          {fuelWaypoint ? (
            <FuelWaypointMarker waypoint={fuelWaypoint} />
          ) : null}

          {approachPolyline && approachPolyline.length >= 2 ? (
            <Polyline
              coordinates={approachPolyline}
              strokeColor={colors.accent}
              strokeWidth={6}
              zIndex={4}
              testID="approach-polyline"
            />
          ) : null}

          {previewPolyline && previewPolyline.length >= 2 ? (
            <Polyline
              coordinates={previewPolyline}
              strokeColor="#4FC3F7"
              strokeWidth={6}
              zIndex={5}
              testID="preview-polyline"
            />
          ) : null}

          {children}
        </MapView>

        {peerMembers && peerMembers.length > 0 ? (
          <PeerLabelsOverlay
            mapRef={mapRef}
            peerMembers={peerMembers}
            regionTick={regionTick}
          />
        ) : null}

        <View pointerEvents="none" style={styles.attributionRow}>
          <Text style={styles.attributionText}>{effectiveAttribution}</Text>
        </View>
      </View>
    );
  },
);

BikerMapView.displayName = 'BikerMapView';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  map: {
    flex: 1,
  },
  attributionRow: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 4,
  },
  attributionText: {
    color: colors.textSecondary,
    fontSize: 10,
  },
});
