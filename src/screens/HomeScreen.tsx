import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BigButton } from '@/shared/components/BigButton';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { HomeMenuDrawer } from '@/shared/components/HomeMenuDrawer';
import { HomeLandscapeMenuContent } from '@/shared/components/HomeLandscapeMenuContent';
import { BikerMapView, type BikerMapHandle } from '@/shared/components/map';
import {
  CloseIcon,
  ComboioIcon,
  CompassIcon,
  CrosshairIcon,
  FuelDropIcon,
  GasPumpIcon,
  GearIcon,
  MapPinIcon,
  MenuIcon,
  PlayIcon,
} from '@/shared/components/icons';
import { PoiListSheet } from '@/shared/components/poi/PoiListSheet';
import { FuelArrivalModal } from '@/shared/components/poi/FuelArrivalModal';
import { RouteAlternativesSheet } from '@/shared/components/route/RouteAlternativesSheet';
import { StampBanner } from '@/shared/components/passport/StampBanner';
import { UpcomingTripBanner } from '@/shared/components/trips/UpcomingTripBanner';
import { WhisperReportButton } from '@/shared/components/whisper/WhisperReportButton';
import {
  EtaBanner,
  GpsLostBadge,
  ManeuverPanel,
  PermissionBanner,
  ProgressBar,
  TripTimerBadge,
} from '@/shared/components/navigation';
import {
  useFuelArrivalDetector,
  FUEL_ARRIVAL_TIMEOUT_MS,
} from '@/shared/hooks/useFuelArrivalDetector';
import type { FilteredFuelPoi } from '@/domains/poi/geometry';
import type { PoiCategory } from '@/domains/poi/types';
import { colors, elevation, radius, spacing, typography } from '@/shared/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useMotorcycleStore,
  selectActiveMotorcycle,
} from '@/state/motorcycleStore';
import { useNavigationStore } from '@/state/navigationStore';
import { useAcceptedSOSStore } from '@/state/acceptedSOSStore';
import { useLocationStore } from '@/state/locationStore';
import { usePoiStore } from '@/state/poiStore';
import { useVoiceGroupStore } from '@/state/voiceGroupStore';
import { useRiderStore } from '@/state/riderStore';
import {
  buildFullCatalogRoute,
  useCatalogStore,
} from '@/state/catalogStore';
import { useLocationTracking } from '@/shared/hooks/useLocationTracking';
import { useAppStateGuard } from '@/shared/hooks/useAppStateGuard';
import { useNavigationEngine } from '@/shared/hooks/useNavigationEngine';
import { useMovementLock } from '@/shared/hooks/useMovementLock';
import { useGpsFreshness } from '@/shared/hooks/useGpsFreshness';
import { useWeatherTracker } from '@/shared/hooks/useWeatherTracker';
import { useWeatherStore } from '@/state/weatherStore';
import { osrmClient } from '@/infrastructure/routing/osrmClient';
import type { Route } from '@/domains/routing/types';
import {
  calculateMaxAutonomy,
  calculateRemainingAutonomy,
  calculateSafeAutonomy,
  RESERVE_THRESHOLD_KM,
} from '@/domains/fuel/autonomy';
import {
  formatDistance,
  formatDuration,
  formatKmWhole,
} from '@/shared/utils/format';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type AutonomyState = 'ok' | 'warning' | 'danger';

const DANGER_THRESHOLD_KM = 20;
const CONFIRMATION_TTL_MS = 2500;
const OFF_ROUTE_GRACE_MS = 5000;
const REROUTE_COOLDOWN_MS = 15000;
/**
 * Fixed palette used by the multi-route picker. Three slots so we always
 * get a distinct, easy-to-tell-apart colour per OSRM alternative. The
 * first slot reuses the existing accent so the "MAIS RÁPIDA" card matches
 * the rest of the brand chrome; the other two are supporting hues that
 * still stand out on the dark basemap. Keep the array length aligned with
 * `getRouteAlternatives`'s default max (3).
 */
const ROUTE_ALTERNATIVE_COLORS: readonly string[] = [
  colors.accent,
  '#4FC3F7',
  '#BA68C8',
];
const FALLBACK_DESTINATION_LABEL = 'destino selecionado';
/**
 * Minimum time the rider must spend OUT of reserve mode before the POI
 * auto-open one-shot guard is allowed to re-arm. A brief GPS-noise dip
 * below the threshold (autonomy bouncing around the boundary) would
 * otherwise re-fire the auto-open the moment we tip back into reserve.
 */
const RESERVE_HYSTERESIS_MS = 15000;

function deriveAutonomyState(remainingKm: number): AutonomyState {
  if (remainingKm <= DANGER_THRESHOLD_KM) return 'danger';
  if (remainingKm <= RESERVE_THRESHOLD_KM) return 'warning';
  return 'ok';
}

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  // Pull device safe-area insets so the portrait chrome (topBar / bottomBar)
  // can avoid the notch up top and the gesture nav bar at the bottom on
  // modern Android + iOS hardware.
  const insets = useSafeAreaInsets();
  // Permission + GPS tracking. The hook auto-starts the watcher; we surface
  // its status to the user via the PermissionBanner below.
  const { permission, lastError, retry, openSettings } = useLocationTracking();
  // Pause/resume GPS when the OS sends the app to the background.
  useAppStateGuard(true);
  // Speed-gated keyboard lock and GPS freshness indicator.
  const { isMoving } = useMovementLock();
  const { isGpsStale, staleSeconds } = useGpsFreshness();

  const userPos = useNavigationStore((s) => s.currentPosition);
  const destination = useNavigationStore((s) => s.destination);
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const tripStartedAt = useNavigationStore((s) => s.tripStartedAt);
  const activeRoute = useNavigationStore((s) => s.activeRoute);
  const distanceTraveledKm = useNavigationStore((s) => s.distanceTraveledKm);
  const isReserveModeFlag = useNavigationStore((s) => s.isReserveMode);
  const isFetchingRoute = useNavigationStore((s) => s.isFetchingRoute);
  const lastReroutedAt = useNavigationStore((s) => s.lastReroutedAt);
  const stopNavigation = useNavigationStore((s) => s.stopNavigation);
  const resetTrip = useNavigationStore((s) => s.resetTrip);
  const setActiveRoute = useNavigationStore((s) => s.setActiveRoute);
  const setRouteError = useNavigationStore((s) => s.setRouteError);
  const setFetchingRoute = useNavigationStore((s) => s.setFetchingRoute);
  const markReroutedNow = useNavigationStore((s) => s.markReroutedNow);
  const pendingFuelWaypoint = useNavigationStore((s) => s.pendingFuelWaypoint);
  const injectFuelWaypoint = useNavigationStore((s) => s.injectFuelWaypoint);
  const removeFuelWaypoint = useNavigationStore((s) => s.removeFuelWaypoint);
  const confirmFuelArrival = useNavigationStore((s) => s.confirmFuelArrival);
  const routeAlternatives = useNavigationStore((s) => s.routeAlternatives);
  const setRouteAlternatives = useNavigationStore(
    (s) => s.setRouteAlternatives,
  );
  const setDestination = useNavigationStore((s) => s.setDestination);
  const startNavigation = useNavigationStore((s) => s.startNavigation);

  // F29.3: pilula SOS no mapa quando o piloto aceitou socorrer alguem.
  // Quando preenchido, BikerMapView substitui o DestinationMarker regular
  // pelo SOSAlertMarker (vermelho com texto "SOS"). O store auto-limpa
  // via subscriber em IncomingSOSMount quando destination muda.
  const acceptedSOS = useAcceptedSOSStore((s) => s.active);

  // Catalog preview integration. `previewRouteId` is a passive overlay flag
  // — non-null when the rider tapped "VER ROTA NO MAPA" on a CatalogResults
  // card. The OSRM-resolved legs (approach + main) live in the catalog
  // store; we fall back to the straight-line `polilinha_simplificada` when
  // OSRM is still loading or failed.
  const previewRouteId = useCatalogStore((s) => s.previewRouteId);
  const catalogResults = useCatalogStore((s) => s.results);
  const setPreviewRoute = useCatalogStore((s) => s.setPreviewRoute);
  const clearPreview = useCatalogStore((s) => s.clearPreview);
  const loadPreviewRoutes = useCatalogStore((s) => s.loadPreviewRoutes);
  const approachRoute = useCatalogStore((s) => s.approachRoute);
  const previewRoute = useCatalogStore((s) => s.previewRoute);
  const isFetchingPreview = useCatalogStore((s) => s.isFetchingPreview);
  const previewError = useCatalogStore((s) => s.previewError);

  const previewMatch = useMemo(() => {
    if (!previewRouteId) return null;
    return (
      catalogResults.find((m) => m.route.rota_id === previewRouteId) ?? null
    );
  }, [previewRouteId, catalogResults]);

  // Blue polyline: OSRM result if available, otherwise the raw catalog
  // polyline (straight-line fallback so the rider still sees SOMETHING
  // while the OSRM call is in flight or after a failure).
  const previewPolyline = useMemo(() => {
    if (!previewRouteId || !previewMatch) return undefined;
    if (previewRoute && previewRoute.coordinates.length >= 2) {
      return previewRoute.coordinates;
    }
    if (previewMatch.route.polilinha_simplificada.length >= 2) {
      return previewMatch.route.polilinha_simplificada.map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      }));
    }
    return undefined;
  }, [previewRouteId, previewMatch, previewRoute]);

  // Orange polyline (rider → route start). OSRM result if available,
  // otherwise a degenerate 2-point segment between userPos and the catalog
  // route's coordenada_inicio so the rider sees the gap they need to ride
  // even when OSRM is unreachable.
  const approachPolyline = useMemo(() => {
    if (!previewRouteId || !previewMatch) return undefined;
    if (approachRoute && approachRoute.coordinates.length >= 2) {
      return approachRoute.coordinates;
    }
    if (!userPos) return undefined;
    return [
      { latitude: userPos.latitude, longitude: userPos.longitude },
      {
        latitude: previewMatch.route.coordenada_inicio.latitude,
        longitude: previewMatch.route.coordenada_inicio.longitude,
      },
    ];
  }, [previewRouteId, previewMatch, approachRoute, userPos]);

  // Fire the OSRM lookups whenever the rider picks a route to preview (or
  // their GPS becomes available). The flag below makes the in-flight
  // promise no-op when the screen unmounts or the previewed id changes
  // before the response arrives.
  useEffect(() => {
    if (!previewRouteId || !userPos) return;
    let cancelled = false;
    void (async () => {
      await loadPreviewRoutes({
        latitude: userPos.latitude,
        longitude: userPos.longitude,
      });
      if (cancelled) return;
      // No further side-effects here — the store already published the
      // response. The cleanup flag exists purely to dodge a setState on a
      // stale closure if the rider switches preview ids while we are
      // waiting on OSRM.
    })();
    return () => {
      cancelled = true;
    };
    // Re-running on every userPos tick would spam OSRM. We intentionally
    // bind to userPos identity (it changes once per GPS sample) but the
    // store internally short-circuits if the id has not changed (cache
    // hit). For tighter control, we depend on previewRouteId + a coarse
    // lat/lon rounded to 4 decimals (~11m) so micro-jitter does not
    // re-trigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    previewRouteId,
    userPos ? userPos.latitude.toFixed(4) : null,
    userPos ? userPos.longitude.toFixed(4) : null,
  ]);

  const { isPromptOpen, dismissPrompt } = useFuelArrivalDetector();

  // Weather tracker — must run on every HomeScreen mount so the top-bar
  // Clima badge starts populating as soon as we have a GPS fix.
  useWeatherTracker();
  const weatherSnapshot = useWeatherStore((s) => s.current);
  const computeRouteForecast = useWeatherStore((s) => s.computeRouteForecast);
  // Per-trecho weather overlay for the active route. Subscribed here so we
  // can forward it to BikerMapView (and so future screen-level chrome can
  // react to it). The store auto-recomputes this whenever a fresh forecast
  // lands, and we call `clearWeatherRoute` below when navigation stops so a
  // stale rainbow doesn't linger on the idle map.
  const weatherRouteSegments = useWeatherStore((s) => s.routeSegments);
  const clearWeatherRoute = useWeatherStore((s) => s.clearRoute);

  const activeMotorcycle = useMotorcycleStore(selectActiveMotorcycle);
  // Rider profile feeds the landscape drawer header so we show the PILOT's
  // name (and a "Meu Perfil" entry) instead of just the bike label.
  const riderProfile = useRiderStore((s) => s.profile);
  const { derived } = useNavigationEngine();

  // Voice/comboio state — used both for the persistent top-bar badge
  // (visible whenever a comboio is active, in both idle + navigating modes)
  // and to label the COMBOIO FAB.
  const voiceToken = useVoiceGroupStore((s) => s.token);
  const voiceStatus = useVoiceGroupStore((s) => s.status);
  const voiceParticipants = useVoiceGroupStore((s) => s.participants);
  // Live GPS positions of the OTHER comboio members. Each entry is upserted
  // by the JitsiWebView bridge whenever a peer broadcasts; the purge loop
  // below drops anything stale so the map doesn't keep frozen pins after a
  // peer's device goes to sleep or loses GPS.
  const peerPositions = useVoiceGroupStore((s) => s.peerPositions);
  // F30: respeita o toggle local de ocultar pins dos peers no mapa. NAO
  // afeta o broadcast (os outros continuam me vendo) — so suprime a
  // renderizacao dos PeerMemberMarker neste device.
  const peerPinsHidden = useVoiceGroupStore((s) => s.peerPinsHidden);
  const purgeStalePeerPositions = useVoiceGroupStore(
    (s) => s.purgeStalePeerPositions,
  );

  // POI store wiring. We alias `isFetching`/`lastError` to POI-specific
  // names because HomeScreen already binds `isFetchingRoute` (route fetch)
  // and `lastError` (location permission) from other stores.
  const pois = usePoiStore((s) => s.pois);
  const isFetchingPoi = usePoiStore((s) => s.isFetching);
  const lastPoiError = usePoiStore((s) => s.lastError);
  const selectedPoiId = usePoiStore((s) => s.selectedPoiId);
  const fetchAlongRoute = usePoiStore((s) => s.fetchAlongRoute);
  const fetchNearby = usePoiStore((s) => s.fetchNearby);
  const searchMode = usePoiStore((s) => s.searchMode);
  const setSearchMode = usePoiStore((s) => s.setSearchMode);
  const searchCategory = usePoiStore((s) => s.searchCategory);
  const setSearchCategory = usePoiStore((s) => s.setSearchCategory);
  const selectPoi = usePoiStore((s) => s.selectPoi);

  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [poiSheetOpen, setPoiSheetOpen] = useState<boolean>(false);
  const [alternativesSheetOpen, setAlternativesSheetOpen] =
    useState<boolean>(false);
  const [arrivalRemainingSecs, setArrivalRemainingSecs] =
    useState<number | null>(null);
  // Landscape collapses all top/bottom chrome into a slide-in drawer behind
  // a single MENU FAB so the map can use the full viewport. Portrait keeps
  // the original layout 100% intact.
  const { width: viewportWidth, height: viewportHeight } =
    useWindowDimensions();
  const isLandscape = viewportWidth > viewportHeight;
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  // Shrink the drawer on very narrow landscape viewports (e.g. small phones
  // rotated) so it never covers more than ~70% of the screen.
  const drawerWidthDp = Math.min(320, Math.round(viewportWidth * 0.7));
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapHandleRef = useRef<BikerMapHandle | null>(null);
  // One-shot guard for the auto-open on reserve mode. Set to true the first
  // time we auto-open the sheet for the current reserve-mode entry, and
  // reset to false only after the rider has been OUT of reserve mode for
  // at least RESERVE_HYSTERESIS_MS (so a momentary autonomy dip caused by
  // GPS noise does not immediately re-arm the auto-open).
  const reserveAutoOpenedRef = useRef<boolean>(false);
  // Wall-clock timestamp of the most recent transition out of reserve mode.
  // Used together with RESERVE_HYSTERESIS_MS to decide whether enough time
  // has elapsed to re-arm `reserveAutoOpenedRef`. Null until the first exit.
  const reserveExitedAtRef = useRef<number | null>(null);
  // Tracks the previous value of `isReserveModeFlag` across renders so the
  // auto-open effect below can detect the true→false transition exactly
  // once (and only then stamp `reserveExitedAtRef`).
  const prevReserveFlagRef = useRef<boolean>(false);
  // Mounted flag so a slow OSRM response after stopNavigation does not
  // try to set state on a now-stale screen.
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (confirmationTimer.current) {
        clearTimeout(confirmationTimer.current);
        confirmationTimer.current = null;
      }
    };
  }, []);

  // Bump the GPS accuracy mode while actively navigating. We only fire the
  // store mutation when isNavigating actually CHANGES (not on the initial
  // mount): otherwise a fresh HomeScreen mount triggers a useless stop→start
  // cycle on the location watcher, which can leave GPS off briefly and make
  // the marker appear missing in idle mode. The watcher already starts in
  // 'high' from useLocationTracking.
  const prevNavRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevNavRef.current;
    prevNavRef.current = isNavigating;
    if (prev === null) return;
    if (prev === isNavigating) return;
    const { setAccuracyMode } = useLocationStore.getState();
    if (isNavigating) {
      void setAccuracyMode('best-for-navigation');
    } else {
      void setAccuracyMode('high');
    }
  }, [isNavigating]);

  // On unmount, drop accuracy back to 'high' if we'd left it bumped up.
  useEffect(() => {
    return () => {
      const { accuracyMode, setAccuracyMode } = useLocationStore.getState();
      if (accuracyMode === 'best-for-navigation') {
        void setAccuracyMode('high');
      }
    };
  }, []);

  // Peer-position staleness sweep. While the rider is in an active comboio
  // (token !== null) we run a 5s interval that drops entries older than
  // 15s — peers whose phones backgrounded, lost GPS, or simply stopped
  // broadcasting. The interval is cleared when the comboio ends so we
  // don't pay for it on the lobby/idle screens.
  useEffect(() => {
    if (voiceToken === null) return;
    const handle = setInterval(() => {
      purgeStalePeerPositions(15000);
    }, 5000);
    return () => {
      clearInterval(handle);
    };
  }, [voiceToken, purgeStalePeerPositions]);

  // Flatten the keyed Record into an array for the map renderer. Memoised so
  // BikerMapView doesn't see a new array reference (and re-bind its
  // children) on every unrelated HomeScreen re-render.
  const peerMembersArray = useMemo(
    () => (peerPinsHidden ? [] : Object.values(peerPositions)),
    [peerPositions, peerPinsHidden],
  );

  // Pair each OSRM alternative with a fixed palette colour for the map.
  // We assign by index so the first (fastest) alternative always renders
  // in `colors.accent` — matching the "MAIS RÁPIDA" tag on its card.
  // Memoised by routeAlternatives so BikerMapView's prop identity does not
  // bounce on every unrelated HomeScreen re-render.
  const mapAlternatives = useMemo(() => {
    if (!routeAlternatives) return undefined;
    return routeAlternatives.map((r, i) => ({
      id: `alt-${i}`,
      coordinates: r.coordinates,
      color:
        ROUTE_ALTERNATIVE_COLORS[i] ??
        ROUTE_ALTERNATIVE_COLORS[ROUTE_ALTERNATIVE_COLORS.length - 1] ??
        colors.accent,
    }));
  }, [routeAlternatives]);

  // Tracks which active route we have already shown the rain alert for, so
  // a re-render of HomeScreen (or a navigation-state nudge) does not pop
  // the Alert twice. We dedupe by route object identity — `setActiveRoute`
  // produces a fresh `Route` per OSRM fetch, so this is stable across normal
  // start/stop/reroute flows.
  const rainAlertedForRef = useRef<Route | null>(null);
  // Tracks the previous activeRoute so we can detect the null -> non-null
  // transition (or a swap to a different Route) and trigger the forecast.
  const prevActiveRouteRef = useRef<typeof activeRoute>(null);

  // Track the previous value of `routeAlternatives` so we can detect the
  // exact null -> array transition. Opening on every render when the value
  // is non-null would re-trigger the sheet after the rider dismisses it.
  const prevAltsRef = useRef<typeof routeAlternatives>(null);
  useEffect(() => {
    const prev = prevAltsRef.current;
    prevAltsRef.current = routeAlternatives;
    if (prev === null && routeAlternatives !== null) {
      setAlternativesSheetOpen(true);
    }
    if (routeAlternatives === null) {
      // Alternatives cleared (either the rider picked one — setActiveRoute
      // wipes them — or the user closed the sheet without picking). Make
      // sure the local sheet state reflects that so a stale "open" boolean
      // does not keep the modal in the tree.
      setAlternativesSheetOpen(false);
    }
  }, [routeAlternatives]);

  // Route-forecast rain alert. When `activeRoute` transitions from null to
  // a non-null value (or to a different Route reference, e.g. after a
  // reroute), compute the forecast along the new polyline. If rain is
  // expected, surface ONE alert per route — we key the dedupe ref by the
  // actual Route object identity, so a re-render or unrelated store update
  // does not re-fire the popup.
  useEffect(() => {
    const prev = prevActiveRouteRef.current;
    prevActiveRouteRef.current = activeRoute;
    if (!activeRoute) {
      // Route cleared (stop/cancel/reroute mid-flight) — reset the dedupe
      // so the next route gets its own one-shot, and drop any cached
      // weather segments so the idle map doesn't keep painting a coloured
      // overlay on an empty route.
      rainAlertedForRef.current = null;
      clearWeatherRoute();
      return;
    }
    if (prev === activeRoute) return;
    // New / changed route: compute its forecast.
    let cancelled = false;
    void (async () => {
      const forecast = await computeRouteForecast({
        routeCoordinates: activeRoute.coordinates,
        durationSeconds: activeRoute.durationSeconds,
      });
      if (cancelled || !isMountedRef.current) return;
      if (!forecast || !forecast.rainExpected) return;
      if (rainAlertedForRef.current === activeRoute) return;
      rainAlertedForRef.current = activeRoute;
      Alert.alert('Alerta de chuva', forecast.summary);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRoute, computeRouteForecast, clearWeatherRoute]);

  // Countdown for the FuelArrivalModal auto-dismiss. When the prompt opens we
  // seed the timer at FUEL_ARRIVAL_TIMEOUT_MS / 1000 seconds and decrement
  // each second. The interval is the SOLE owner of the timer ref — both the
  // cleanup callback and the prompt-close branch tear it down so we never
  // leak (component unmount, prompt dismissed early via SIM/NÃO, or the
  // countdown hitting zero naturally — the detector hook fires its own
  // dismiss on timeout, which closes `isPromptOpen` and re-runs this effect).
  useEffect(() => {
    if (!isPromptOpen) {
      // Clear any lingering value so the next open seeds a fresh countdown
      // (and the modal hides its countdown row in the meantime).
      if (arrivalRemainingSecs !== null) {
        setArrivalRemainingSecs(null);
      }
      return;
    }

    setArrivalRemainingSecs(Math.ceil(FUEL_ARRIVAL_TIMEOUT_MS / 1000));
    const interval = setInterval(() => {
      setArrivalRemainingSecs((prev) => {
        if (prev === null) return prev;
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
    // We intentionally do NOT depend on `arrivalRemainingSecs` here —
    // including it would tear down and rebuild the interval every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPromptOpen]);

  // Off-route auto recalculation. The engine reports `isOffRoute` plus a
  // sticky `offRouteSinceMs` timestamp. We require:
  //   1. The rider has been off-route for at least 5s (debounce GPS noise).
  //   2. At least 15s passed since the previous reroute (cooldown so we
  //      don't spam OSRM if the new route also doesn't match the rider).
  //   3. We have both a destination and a current position.
  //   4. We're not already fetching a route.
  useEffect(() => {
    if (!derived || !isNavigating) return;
    if (!derived.isOffRoute) return;
    if (derived.offRouteSinceMs === null) return;
    if (!destination || !userPos) return;
    if (isFetchingRoute) return;

    const now = Date.now();
    const offRouteFor = now - derived.offRouteSinceMs;
    const sinceLastReroute = now - (lastReroutedAt ?? 0);

    if (offRouteFor < OFF_ROUTE_GRACE_MS) return;
    if (sinceLastReroute < REROUTE_COOLDOWN_MS) return;

    let cancelled = false;
    setFetchingRoute(true);
    setRouteError(null);

    void (async () => {
      try {
        const newRoute = await osrmClient.getRoute({
          start: { latitude: userPos.latitude, longitude: userPos.longitude },
          end: {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
        });
        if (cancelled || !isMountedRef.current) return;
        setActiveRoute(newRoute);
        markReroutedNow();
      } catch (err) {
        if (cancelled || !isMountedRef.current) return;
        setRouteError(err instanceof Error ? err.message : String(err));
      } finally {
        // Always clear isFetchingRoute, even when the effect was cancelled.
        // Otherwise a cancelled in-flight reroute leaves the flag stuck on
        // forever, blocking every subsequent off-route trigger.
        if (isMountedRef.current) {
          setFetchingRoute(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    derived,
    isNavigating,
    destination,
    userPos,
    isFetchingRoute,
    lastReroutedAt,
    setActiveRoute,
    setFetchingRoute,
    setRouteError,
    markReroutedNow,
  ]);

  // Auto-open POI sheet on the rider's first entry into reserve mode. We
  // gate on `reserveAutoOpenedRef` so closing the sheet does NOT immediately
  // re-open it on the next render cycle. The ref is reset only after the
  // rider has been continuously OUT of reserve mode for RESERVE_HYSTERESIS_MS
  // (see reserveExitedAtRef) — a brief dip below the threshold caused by GPS
  // noise will NOT re-arm the auto-open.
  useEffect(() => {
    // Edge-detect reserve mode transitions so we only stamp the exit
    // timestamp once per true→false flip (not on every re-render while
    // reserve is false, which would reset the elapsed-window to ~0).
    const wasReserve = prevReserveFlagRef.current;
    prevReserveFlagRef.current = isReserveModeFlag;

    if (!isNavigating || !isReserveModeFlag) {
      if (!isReserveModeFlag) {
        if (wasReserve) {
          // True→false transition: start the hysteresis window.
          reserveExitedAtRef.current = Date.now();
        }
        const exitedAt = reserveExitedAtRef.current;
        if (
          exitedAt !== null &&
          Date.now() - exitedAt > RESERVE_HYSTERESIS_MS
        ) {
          reserveAutoOpenedRef.current = false;
        }
      }
      return;
    }
    // Reserve is currently true — clear the exit timestamp so the next
    // false transition starts a fresh hysteresis window.
    reserveExitedAtRef.current = null;
    if (reserveAutoOpenedRef.current) return;
    if (pois.length > 0) return;
    if (isFetchingPoi) return;
    if (lastPoiError) return;

    reserveAutoOpenedRef.current = true;
    void (async () => {
      await fetchAlongRoute();
      if (!isMountedRef.current) return;
      setPoiSheetOpen(true);
    })();
  }, [
    isNavigating,
    isReserveModeFlag,
    pois.length,
    isFetchingPoi,
    lastPoiError,
    fetchAlongRoute,
  ]);

  // When the rider stops navigating, drop the cached POI list and reset
  // the auto-open one-shot guard (and the hysteresis state) so the next
  // trip starts clean. We call the store imperatively (rather than via a
  // selector) to avoid re-running this effect every time clearPois
  // identity changes.
  useEffect(() => {
    if (isNavigating) return;
    usePoiStore.getState().clearPois();
    reserveAutoOpenedRef.current = false;
    reserveExitedAtRef.current = null;
    prevReserveFlagRef.current = false;
    setPoiSheetOpen(false);
  }, [isNavigating]);

  const tankCapacity = activeMotorcycle?.tankCapacity ?? 0;
  const averageConsump = activeMotorcycle?.averageConsump ?? 0;
  const maxAutonomy = calculateMaxAutonomy(tankCapacity, averageConsump);
  const safeAutonomy = calculateSafeAutonomy(maxAutonomy);
  const remainingAutonomyKm = activeMotorcycle
    ? calculateRemainingAutonomy(safeAutonomy, distanceTraveledKm)
    : 0;

  const autonomyState: AutonomyState = activeMotorcycle
    ? deriveAutonomyState(remainingAutonomyKm)
    : 'warning';
  const effectiveState: AutonomyState =
    isReserveModeFlag && autonomyState === 'ok' ? 'warning' : autonomyState;

  // Weather badge derivation. While we are still waiting for the first
  // Open-Meteo response the badge shows a neutral "Carregando..." pill so
  // the rider gets an immediate signal that the value is real (vs the old
  // hard-coded "Seco"). Severity is mapped 1:1 from the snapshot's app
  // bucket and falls back to 'neutral' until we have data.
  const weatherValue: string = weatherSnapshot
    ? `${weatherSnapshot.label} ${Math.round(weatherSnapshot.temperatureC)}°`
    : '...';
  const weatherBadgeState: 'ok' | 'warning' | 'danger' | 'neutral' =
    weatherSnapshot ? weatherSnapshot.severity : 'neutral';

  const handleTanqueCheio = (): void => {
    resetTrip();
    setConfirmation('Tanque cheio registrado!');
    if (confirmationTimer.current) {
      clearTimeout(confirmationTimer.current);
    }
    confirmationTimer.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      setConfirmation(null);
      confirmationTimer.current = null;
    }, CONFIRMATION_TTL_MS);
  };

  const handleEditMoto = (): void => {
    if (isMoving) {
      Alert.alert(
        'Locked',
        'Pare a moto para digitar o destino. Detectado movimento (> 5 km/h).',
      );
      return;
    }
    navigation.navigate('MotorcycleSetup', {
      editMotorcycleId: activeMotorcycle?.id,
    });
  };

  const handleChooseDestination = (): void => {
    if (isMoving) {
      Alert.alert(
        'Locked',
        'Pare a moto para digitar o destino. Detectado movimento (> 5 km/h).',
      );
      return;
    }
    navigation.navigate('DestinationSearch');
  };

  const handleExploreCatalog = (): void => {
    if (isMoving) {
      Alert.alert(
        'Locked',
        'Pare a moto para explorar viagens. Detectado movimento (> 5 km/h).',
      );
      return;
    }
    // F35.0.C — entramos direto na lista de resultados; o piloto vai
    // ajustar filtros pelo botao na propria tela so se quiser. Defaults
    // sao aplicados em CatalogResults via runDefaultSearch.
    navigation.navigate('CatalogResults');
  };

  // Settings hub. Intentionally NOT movement-locked — the hub itself is
  // read-only (status text + buttons) and its inner jump-offs (perfil /
  // motos) already enforce their own lock. Forcing a lock here would also
  // hide the "Sobre" credits when the rider is moving, which has no safety
  // rationale.
  const handleOpenSettings = (): void => {
    navigation.navigate('Settings');
  };

  const handleClearPreview = (): void => {
    clearPreview();
  };

  const handleStartCatalogRoute = (): void => {
    if (isMoving) {
      Alert.alert(
        'Locked',
        'Pare a moto para iniciar a rota. Detectado movimento (> 5 km/h).',
      );
      return;
    }
    if (!previewMatch || !userPos) return;
    setFetchingRoute(true);
    setRouteError(null);
    void (async () => {
      try {
        const fullRoute = await buildFullCatalogRoute(previewMatch, {
          latitude: userPos.latitude,
          longitude: userPos.longitude,
        });
        if (!isMountedRef.current) return;
        // Destination is the catalog route's end point; label keeps the
        // route name short so the EtaBanner/turn-by-turn UI does not blow
        // out. We use the structured GeoPosition shape so existing
        // downstream consumers (engine, ETA, weather) keep working.
        // GeoPosition expects a timestamp; for a destination this is just
        // the moment the rider confirmed the trip — useful in logs / debug
        // but otherwise irrelevant.
        setDestination({
          latitude: previewMatch.route.coordenada_fim.latitude,
          longitude: previewMatch.route.coordenada_fim.longitude,
          timestamp: Date.now(),
        });
        setActiveRoute(fullRoute);
        startNavigation();
        clearPreview();
      } catch (err) {
        if (!isMountedRef.current) return;
        const message =
          err instanceof Error && err.message.length > 0
            ? err.message
            : 'Falha ao calcular a rota';
        setRouteError(message);
        Alert.alert(
          'Erro',
          'Não foi possível calcular a rota. Tente novamente.',
        );
      } finally {
        if (isMountedRef.current) {
          setFetchingRoute(false);
        }
      }
    })();
  };

  const handleRecenter = (): void => {
    mapHandleRef.current?.centerOnUser();
  };

  const handleOpenComboio = (): void => {
    navigation.navigate('Comboio');
  };

  const handleCancelNavigation = (): void => {
    stopNavigation();
  };

  const handleOpenPostos = (): void => {
    setPoiSheetOpen(true);
    // Default mode depends on context: when actively navigating + in reserve,
    // the rider wants stations along the remaining route (RF04). Otherwise
    // the rider opening "POSTOS" manually most likely wants the nearest
    // stations regardless of route geometry — typical use is "I need fuel
    // RIGHT NOW", and side streets / parallel roads should not be excluded.
    const wantsAlongRoute = isNavigating && isReserveModeFlag;
    if (wantsAlongRoute) {
      void fetchAlongRoute();
    } else {
      void fetchNearby();
    }
  };

  const handleSheetModeChange = (mode: 'along-route' | 'nearby'): void => {
    void setSearchMode(mode);
  };

  const handleSheetCategoryChange = (category: PoiCategory): void => {
    // The store handles clearing `pois`/`selectedPoiId` and dispatching the
    // refetch under the current searchMode; HomeScreen just forwards the
    // chip tap.
    void setSearchCategory(category);
  };

  const handleClosePoiSheet = (): void => {
    setPoiSheetOpen(false);
  };

  const handleSelectPoi = (poi: { id: string }): void => {
    // Don't close the sheet here — the "Desviar para este posto" button is
    // only rendered inside the selected row. Closing on tap would force the
    // rider to reopen the sheet to confirm the detour.
    selectPoi(poi.id);
  };

  const handleDetour = (poi: FilteredFuelPoi): void => {
    // FilteredFuelPoi extends FuelPoi, so passing it straight through to
    // injectFuelWaypoint(poi: FuelPoi) is structurally safe.
    void injectFuelWaypoint(poi);
    setPoiSheetOpen(false);
  };

  const handlePickAlternative = (index: number): void => {
    // Defensive guard: the picker can theoretically race the store (rider
    // taps just as alternatives are cleared by a competing flow). When the
    // requested index is out of range we silently close the sheet without
    // mutating any other state.
    if (!routeAlternatives) {
      setAlternativesSheetOpen(false);
      return;
    }
    const picked = routeAlternatives[index];
    if (!picked) {
      setAlternativesSheetOpen(false);
      return;
    }
    // setActiveRoute also clears `routeAlternatives` (see navigationStore).
    // We close the local sheet flag here too so the modal teardown does not
    // race the alternatives clear effect.
    setActiveRoute(picked);
    setAlternativesSheetOpen(false);
    startNavigation();
  };

  const handleCloseAlternatives = (): void => {
    // The rider abandoned the picker. Clear BOTH the alternatives bag and
    // the captured destination so they return to a clean idle state and
    // the next "ESCOLHER DESTINO" tap starts fresh.
    setAlternativesSheetOpen(false);
    setRouteAlternatives(null);
    setDestination(null);
  };

  const motoLabel = activeMotorcycle
    ? `${activeMotorcycle.brand} ${activeMotorcycle.model}`
    : 'Nenhuma moto ativa';

  const showRecalculating = isNavigating && isFetchingRoute;
  const hasNavOverlay = isNavigating && derived !== null;

  // Compact preview metrics shown above the INICIAR ROTA button. We render
  // a single status line per leg when OSRM is done, fall back to a generic
  // "Calculando..." while we are still waiting, and surface a soft error
  // message when both legs failed (the straight-line fallbacks are still
  // visible on the map at that point).
  const previewApproachLine: string | null = previewMatch
    ? approachRoute
      ? `Até o início: ${formatDistance(approachRoute.distanceMeters)} • ${formatDuration(approachRoute.durationSeconds)}`
      : null
    : null;
  const previewMainLine: string | null = previewMatch
    ? previewRoute
      ? `Rota: ${formatDistance(previewRoute.distanceMeters)} • ${formatDuration(previewRoute.durationSeconds)}`
      : null
    : null;
  // Short variant of the route name for the INICIAR ROTA label so the
  // button does not overflow on small viewports. We aim for ~22 chars
  // total including the "INICIAR — " prefix; BigButton already
  // adjusts-font-size in `compact` mode but the non-compact preview button
  // does not, so trimming here is the safer guard.
  function shortRouteName(full: string): string {
    if (full.length <= 22) return full;
    return `${full.slice(0, 20).trimEnd()}…`;
  }
  const startLabel = previewMatch
    ? `INICIAR — ${shortRouteName(previewMatch.route.nome_rota)}`
    : 'INICIAR ROTA';
  const isStartDisabled = !previewMatch || !userPos || isFetchingRoute;

  // Right-edge FAB column vertical offsets (recenter → comboio → menu).
  // The bottombar height varies a lot across modes, so we shift the whole
  // FAB column to stay ~24dp above whatever bottombar is currently shown:
  //   - Landscape: bottombar is hidden → only clear gesture-nav insets.
  //   - Preview (catalog metrics card + INICIAR ROTA): tallest portrait
  //     mode (~220-260dp tall).
  //   - Idle (DESTINO stacked above EXPLORAR compact): ~180-200dp tall.
  //   - In-route (3 compact buttons in one row): shortest portrait
  //     (~110-140dp tall).
  // 70dp gap between FABs keeps a clean visual column (FAB = 56-64dp).
  const recenterBottom: number = isLandscape
    ? 24
    : previewRouteId && !isNavigating
      ? 240
      : isNavigating
        ? 140
        : 200;
  const comboioBottom: number = recenterBottom + 70;
  const menuBottom: number = comboioBottom + 70;
  // SETTINGS FAB is always visible (portrait + landscape) so the rider can
  // jump to perfil / motos at any time. It sits ABOVE menu in landscape
  // (the only mode where menu exists) and directly above COMBOIO in
  // portrait — same 70dp gap as the rest of the column.
  const settingsBottom: number = isLandscape
    ? menuBottom + 70
    : comboioBottom + 70;
  // In landscape on phones with side gesture-nav (Samsung One UI, Android 12+
  // bottom-edge swipe rotated), the right safe-area inset is non-zero. Without
  // honoring it, the FAB column overlaps the gesture handle and taps get
  // hijacked by the OS. We pad an extra `spacing.sm` so the FAB is visibly
  // off the rail too.
  const fabsRight: number = isLandscape
    ? Math.max(spacing.lg, insets.right + spacing.sm)
    : spacing.lg;

  return (
    <View style={styles.root} testID="screen-home">
      {/* F35.3 — Banner de stamp aparece quando o piloto completa uma rota. */}
      <StampBanner />
      {/* F35.8 — Banner de lembrete pre-trip (D-1 ou D de uma SavedTrip). */}
      <UpcomingTripBanner />
      {/* F35.9 — Botao flutuante de reportar Whisper durante navegacao
          ativa de rota do catalogo. */}
      <WhisperReportButton />
      <View style={StyleSheet.absoluteFill}>
        <BikerMapView
          ref={mapHandleRef}
          userPosition={userPos}
          destination={destination ?? null}
          routeCoordinates={activeRoute?.coordinates}
          followUser={isNavigating}
          mode={isNavigating ? 'navigating' : 'idle'}
          tileMode="auto"
          pois={pois}
          selectedPoiId={selectedPoiId}
          onPoiPress={(poi) => selectPoi(poi.id)}
          fuelWaypoint={pendingFuelWaypoint}
          peerMembers={peerMembersArray}
          routeAlternatives={mapAlternatives}
          weatherSegments={weatherRouteSegments ?? undefined}
          previewPolyline={previewPolyline}
          approachPolyline={approachPolyline}
          sosAlertMarker={
            acceptedSOS !== null
              ? {
                  latitude: acceptedSOS.latitude,
                  longitude: acceptedSOS.longitude,
                }
              : null
          }
          testID="home-map"
        />
      </View>

      {isNavigating && tripStartedAt !== null ? (
        <View
          pointerEvents="none"
          style={[
            styles.tripTimerSlot,
            {
              top: Math.max(spacing['2xl'], insets.top + spacing.sm),
              left: Math.max(spacing.lg, insets.left + spacing.sm),
            },
          ]}
        >
          <TripTimerBadge
            tripStartedAt={tripStartedAt}
            etaSeconds={derived?.etaSeconds ?? null}
          />
        </View>
      ) : null}

      {!isLandscape ? (
        <View
          style={[
            styles.topBar,
            // Push the bar below the status bar / notch when the device
            // reports a non-zero top inset. We keep the existing 2xl as a
            // floor so emulators without insets still get the original look.
            { paddingTop: Math.max(spacing['2xl'], insets.top + spacing.sm) },
          ]}
          pointerEvents="box-none"
        >
          {voiceToken ? (
            <View style={styles.comboioBadgeRow}>
              <StatusBadge
                label="Comboio"
                value={`#${voiceToken.code} • ${voiceParticipants.length} on-line`}
                state={voiceStatus === 'connected' ? 'ok' : 'warning'}
                testID="badge-comboio-active"
              />
            </View>
          ) : null}

          {permission !== 'granted' ? (
            <View style={styles.permissionRow}>
              <PermissionBanner
                permission={permission}
                lastError={lastError}
                onRetry={retry}
                onOpenSettings={() => {
                  void openSettings();
                }}
              />
            </View>
          ) : null}

          {isGpsStale ? (
            <View style={styles.gpsLostRow}>
              <GpsLostBadge
                staleSeconds={staleSeconds}
                isGpsStale={isGpsStale}
              />
            </View>
          ) : null}

          {hasNavOverlay && derived ? (
            <>
              <View style={styles.maneuverRow}>
                <ManeuverPanel
                  instruction={derived.maneuver.instruction}
                  distanceMeters={derived.maneuver.distanceToManeuverMeters}
                />
              </View>

              {showRecalculating ? (
                <View style={styles.recalcRow}>
                  <StatusBadge
                    label="Rota"
                    value="Recalculando..."
                    state="neutral"
                    testID="badge-recalculating"
                  />
                </View>
              ) : null}

              <View style={styles.etaRow}>
                <EtaBanner
                  etaSeconds={derived.etaSeconds}
                  remainingMeters={derived.progress.remainingMeters}
                />
              </View>

              <View style={styles.progressRow}>
                <ProgressBar percent={derived.progress.percent} />
              </View>
            </>
          ) : (
            <>
              <View style={styles.topRow}>
                <Text style={styles.motoLabel} numberOfLines={1}>
                  {motoLabel}
                </Text>
                <Pressable
                  onPress={handleEditMoto}
                  // Wider hitSlop than the visual pill so the rider can tap
                  // it cleanly even with gloves on.
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.editMotoPill}
                  accessibilityRole="button"
                  testID="link-edit-moto"
                >
                  <Text style={styles.editMotoPillLabel}>Editar moto</Text>
                </Pressable>
              </View>

              <View style={styles.badgesRow}>
                {/* Each badge sits in its own flex cell so a long autonomy
                    or weather label cannot push the sibling off-screen on
                    narrow 360dp viewports — both shrink together instead. */}
                <View style={styles.badgeCell}>
                  <StatusBadge
                    label="Autonomia"
                    value={formatKmWhole(remainingAutonomyKm)}
                    state={effectiveState}
                    testID="badge-autonomy"
                  />
                </View>
                <View style={styles.badgeSpacer} />
                <View style={styles.badgeCell}>
                  <StatusBadge
                    label="Clima"
                    value={weatherValue}
                    state={weatherBadgeState}
                    testID="badge-weather"
                  />
                </View>
              </View>
            </>
          )}
        </View>
      ) : null}

      {previewRouteId ? (
        <Pressable
          onPress={handleClearPreview}
          accessibilityRole="button"
          accessibilityLabel="Limpar preview de rota"
          style={({ pressed }) => [
            styles.clearPreviewPill,
            // Offset by the top inset so the pill never collides with the
            // notch on devices where the topBar is hidden by the catalog
            // preview gate (we still want it visible above any chrome).
            { top: Math.max(spacing['3xl'], insets.top + spacing['2xl']) },
            pressed ? styles.clearPreviewPillPressed : null,
          ]}
          testID="btn-clear-preview"
        >
          <CloseIcon size={20} color="#FFFFFF" />
        </Pressable>
      ) : null}

      {userPos ? (
        <Pressable
          style={({ pressed }) => [
            styles.recenterFab,
            { bottom: recenterBottom, right: fabsRight },
            pressed ? styles.recenterFabPressed : null,
          ]}
          android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true }}
          onPress={handleRecenter}
          accessibilityRole="button"
          accessibilityLabel="Recentralizar no meu local"
          testID="btn-recenter"
        >
          <CrosshairIcon size={26} color={colors.accent} />
        </Pressable>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.comboioFab,
          { bottom: comboioBottom, right: fabsRight },
          pressed ? styles.comboioFabPressed : null,
        ]}
        android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true }}
        onPress={handleOpenComboio}
        accessibilityRole="button"
        accessibilityLabel="Abrir comboio de voz"
        testID="btn-open-comboio"
      >
        <ComboioIcon size={26} color={colors.textPrimary} />
      </Pressable>

      {!isLandscape && !(alternativesSheetOpen && routeAlternatives !== null) && !previewRouteId ? (
        <View
          style={[
            styles.bottomBar,
            // Raise the bar above the Android gesture-nav pill / iOS home
            // indicator. Floor at the original xl so devices without bottom
            // insets still get the same generous padding as before.
            {
              paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md),
            },
          ]}
          pointerEvents="box-none"
        >
          {pendingFuelWaypoint ? (
            <View style={styles.detourRow}>
              <StatusBadge
                label="Desvio"
                value={`Indo para ${pendingFuelWaypoint.name}`}
                state="warning"
                testID="banner-detour-active"
              />
            </View>
          ) : null}

          {confirmation ? (
            <View style={styles.confirmationRow}>
              <StatusBadge
                label="OK"
                value={confirmation}
                state="ok"
                testID="banner-tanque-confirm"
              />
            </View>
          ) : null}

          {isNavigating ? (
            // Weighted 3-column row: CANCELAR is the rarest/most destructive
            // action and sits on the left at half-width as "Cancelar"; POSTOS
            // is the dominant in-route CTA (primary); TANQUE is the rare full
            // refill confirmation (secondary). Visual weight reflects use
            // frequency on a real trip.
            <View style={styles.actionsRow}>
              <View style={styles.gridCellCancel}>
                <BigButton
                  label="CANCELAR"
                  variant="secondary"
                  fullWidth
                  compact
                  stacked
                  leadingIcon={
                    <CloseIcon size={22} color={colors.textPrimary} />
                  }
                  onPress={handleCancelNavigation}
                  accessibilityLabel="Cancelar navegação"
                  testID="btn-cancel-nav"
                />
              </View>
              <View style={styles.gridSpacer} />
              <View style={styles.gridCell}>
                <BigButton
                  label="LUGARES"
                  variant="primary"
                  fullWidth
                  compact
                  stacked
                  leadingIcon={<MapPinIcon size={24} color="#FFFFFF" />}
                  onPress={handleOpenPostos}
                  accessibilityLabel="Buscar lugares (postos, restaurantes, hoteis, pousadas, borracheiros, oficinas)"
                  testID="btn-open-postos"
                />
              </View>
              <View style={styles.gridSpacer} />
              <View style={styles.gridCell}>
                <BigButton
                  label="TANQUE"
                  variant="secondary"
                  fullWidth
                  compact
                  stacked
                  leadingIcon={
                    <FuelDropIcon size={22} color={colors.textPrimary} />
                  }
                  onPress={handleTanqueCheio}
                  accessibilityLabel="Registrar tanque cheio"
                  testID="btn-tanque-cheio"
                />
              </View>
            </View>
          ) : (
            <View>
              {/* F36.1.1 — Quando ha uma rota tracada mas sem navegacao
                  ativa (ex: app foi morto antes de INICIAR, ou rota
                  ficou parada por algum motivo), oferece LIMPAR ROTA
                  pra o piloto poder voltar ao zero sem ter que tracar
                  outra rota por cima. */}
              {activeRoute !== null ? (
                <View style={styles.clearRouteRow}>
                  <BigButton
                    label="LIMPAR ROTA"
                    variant="secondary"
                    fullWidth
                    compact
                    leadingIcon={
                      <CloseIcon size={22} color={colors.textPrimary} />
                    }
                    onPress={handleCancelNavigation}
                    accessibilityLabel="Limpar a rota tracada"
                    testID="btn-clear-route"
                  />
                </View>
              ) : null}
              <BigButton
                label="DESTINO"
                variant="primary"
                fullWidth
                leadingIcon={<MapPinIcon size={26} color="#FFFFFF" />}
                onPress={handleChooseDestination}
                accessibilityLabel="Escolher destino"
                testID="btn-choose-destination"
              />
              <View style={styles.exploreButtonRow}>
                <BigButton
                  label="EXPLORAR"
                  variant="secondary"
                  fullWidth
                  compact
                  leadingIcon={
                    <CompassIcon size={22} color={colors.textPrimary} />
                  }
                  onPress={handleExploreCatalog}
                  accessibilityLabel="Explorar viagens do catálogo"
                  testID="btn-explore-catalog"
                />
              </View>
            </View>
          )}
        </View>
      ) : null}

      {!isLandscape && previewRouteId && !isNavigating ? (
        <View
          style={[
            styles.bottomBar,
            {
              paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md),
            },
          ]}
          pointerEvents="box-none"
          testID="preview-bottom-bar"
        >
          <View style={styles.previewMetricsCard}>
            {isFetchingPreview ? (
              <Text
                style={styles.previewMetricsText}
                testID="preview-metrics-loading"
              >
                Calculando rota real...
              </Text>
            ) : previewApproachLine || previewMainLine ? (
              <>
                {previewApproachLine ? (
                  <Text
                    style={styles.previewMetricsText}
                    testID="preview-metrics-approach"
                  >
                    {previewApproachLine}
                  </Text>
                ) : null}
                {previewMainLine ? (
                  <Text
                    style={styles.previewMetricsText}
                    testID="preview-metrics-main"
                  >
                    {previewMainLine}
                  </Text>
                ) : null}
                {previewError ? (
                  <Text
                    style={styles.previewMetricsErrorText}
                    testID="preview-metrics-error"
                  >
                    Não foi possível calcular o trajeto detalhado — usando
                    estimativa.
                  </Text>
                ) : null}
              </>
            ) : previewError ? (
              <Text
                style={styles.previewMetricsErrorText}
                testID="preview-metrics-error"
              >
                Não foi possível calcular o trajeto detalhado — usando
                estimativa.
              </Text>
            ) : null}
          </View>
          <BigButton
            label={startLabel}
            variant="primary"
            fullWidth
            disabled={isStartDisabled}
            leadingIcon={<PlayIcon size={22} color="#FFFFFF" />}
            onPress={handleStartCatalogRoute}
            accessibilityLabel="Iniciar rota selecionada"
            testID="btn-start-catalog-route"
          />
        </View>
      ) : null}

      {isLandscape ? (
        <Pressable
          style={({ pressed }) => [
            styles.menuFab,
            { bottom: menuBottom, right: fabsRight },
            pressed ? styles.menuFabPressed : null,
          ]}
          android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true }}
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Abrir menu"
          testID="btn-open-menu"
        >
          <MenuIcon size={28} color="#FFFFFF" />
        </Pressable>
      ) : null}

      {/* SETTINGS FAB — sempre visivel (portrait + paisagem). E o unico
          ponto de re-entrada pra editar perfil / motos depois do onboarding,
          entao nao pode esconder atras de um drawer modal. */}
      <Pressable
        style={({ pressed }) => [
          styles.settingsFab,
          { bottom: settingsBottom, right: fabsRight },
          pressed ? styles.settingsFabPressed : null,
        ]}
        android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true }}
        onPress={handleOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Abrir configuracoes"
        testID="btn-open-settings"
      >
        <GearIcon size={24} color={colors.textPrimary} />
      </Pressable>

      {isLandscape ? (
        <HomeMenuDrawer
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          widthDp={drawerWidthDp}
        >
          <HomeLandscapeMenuContent
            permission={permission}
            lastError={lastError}
            onRetryPermission={retry}
            onOpenSettings={() => {
              void openSettings();
            }}
            isGpsStale={isGpsStale}
            staleSeconds={staleSeconds}
            riderDisplayName={riderProfile?.displayName ?? null}
            motoLabel={motoLabel}
            remainingAutonomyKm={remainingAutonomyKm}
            autonomyState={effectiveState}
            weatherValue={weatherValue}
            weatherBadgeState={weatherBadgeState}
            voiceTokenCode={voiceToken?.code ?? null}
            voiceParticipantsCount={voiceParticipants.length}
            voiceStatus={voiceStatus}
            isNavigating={isNavigating}
            derived={derived}
            showRecalculating={showRecalculating}
            onEditMoto={handleEditMoto}
            onChooseDestination={handleChooseDestination}
            onCancelNavigation={handleCancelNavigation}
            onOpenPostos={handleOpenPostos}
            onTanqueCheio={handleTanqueCheio}
            onOpenComboio={handleOpenComboio}
            onExploreCatalog={handleExploreCatalog}
            // onEditProfile intentionally NOT passed: the new SETTINGS FAB
            // (always visible, portrait + paisagem) is the single source of
            // truth for jumping into perfil / motos. Keeping it here would
            // duplicate the affordance and split a11y / discoverability.
            closeDrawer={() => setMenuOpen(false)}
          />
        </HomeMenuDrawer>
      ) : null}

      <PoiListSheet
        visible={poiSheetOpen}
        pois={pois}
        isFetching={isFetchingPoi}
        lastError={lastPoiError}
        searchMode={searchMode}
        onSearchModeChange={handleSheetModeChange}
        searchCategory={searchCategory}
        onSearchCategoryChange={handleSheetCategoryChange}
        onClose={handleClosePoiSheet}
        onRefresh={
          searchMode === 'along-route' ? fetchAlongRoute : fetchNearby
        }
        onSelect={handleSelectPoi}
        selectedPoiId={selectedPoiId}
        onDetour={handleDetour}
      />

      <FuelArrivalModal
        visible={isPromptOpen}
        poiName={pendingFuelWaypoint?.name ?? 'Posto'}
        remainingSeconds={arrivalRemainingSecs}
        onConfirm={() => {
          void confirmFuelArrival();
          dismissPrompt();
        }}
        onDismiss={() => {
          void removeFuelWaypoint();
          dismissPrompt();
        }}
      />

      <RouteAlternativesSheet
        visible={alternativesSheetOpen && routeAlternatives !== null}
        alternatives={routeAlternatives ?? []}
        colors={ROUTE_ALTERNATIVE_COLORS.slice(
          0,
          (routeAlternatives ?? []).length,
        )}
        onClose={handleCloseAlternatives}
        onPick={handlePickAlternative}
        isFetching={isFetchingRoute && (routeAlternatives ?? []).length === 0}
        lastError={null}
        destinationLabel={FALLBACK_DESTINATION_LABEL}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing['2xl'],
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(18,18,18,0.78)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  motoLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginRight: spacing.sm,
  },
  // Pill-shaped "Editar moto" entry point. Replaces the previous bare
  // orange link so the affordance reads as tappable from a distance and
  // matches the rest of the surfaceElevated chrome on the home top bar.
  editMotoPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignSelf: 'flex-start',
  },
  editMotoPillLabel: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Wrap each StatusBadge so both halves share the available row width and
  // shrink together — prevents truncation on 360dp Android phones when the
  // weather label is long ("Tempestade 28°", etc.).
  badgeCell: {
    flex: 1,
    flexShrink: 1,
  },
  badgeSpacer: {
    width: spacing.sm,
  },
  permissionRow: {
    marginBottom: spacing.sm,
  },
  gpsLostRow: {
    marginBottom: spacing.sm,
  },
  maneuverRow: {
    marginBottom: spacing.sm,
  },
  recalcRow: {
    marginBottom: spacing.sm,
  },
  etaRow: {
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  progressRow: {
    marginBottom: spacing.xs,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(18,18,18,0.78)',
  },
  confirmationRow: {
    marginBottom: spacing.sm,
  },
  detourRow: {
    marginBottom: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  gridCell: {
    flex: 1,
  },
  // Cancel sits in a narrower half-width slot. The 0.5 weight visually
  // de-emphasises it next to POSTOS (the primary in-route CTA), so the
  // rider doesn't fat-finger "cancel route" while reaching for fuel.
  gridCellCancel: {
    flex: 0.5,
  },
  gridSpacer: {
    width: spacing.sm,
  },
  tripTimerSlot: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  recenterFab: {
    position: 'absolute',
    right: spacing.lg,
    // `bottom` is supplied inline at the call site so the FAB can shift
    // dynamically to clear the bottombar (which has 3 different heights
    // across idle / preview / in-route portrait modes).
    bottom: 140,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    // Centralised FAB shadow token so iOS shadow + Android elevation stay
    // in lock-step across every floating button on the screen.
    ...elevation.fab,
  },
  recenterFabPressed: {
    opacity: 0.7,
  },
  comboioBadgeRow: {
    marginBottom: spacing.sm,
  },
  // Stacked above the recenter FAB on the right edge. Round 56dp so it
  // matches the recenter FAB's diameter for a clean vertical FAB column.
  // `bottom` is overridden inline (= recenterBottom + 70) so the stack
  // stays glued to the recenter FAB across portrait modes.
  comboioFab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 210,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.fab,
  },
  comboioFabPressed: {
    opacity: 0.7,
  },
  // Landscape-only round FAB that opens the HomeMenuDrawer. Stacked above
  // the COMBOIO FAB on the right edge so the order bottom→top reads:
  // recenter → COMBOIO → MENU. `bottom` is overridden inline
  // (= comboioBottom + 70) so the stack glues to the rest of the column.
  // Slightly bigger than the recenter FAB (64dp vs 56dp) so it's easier
  // to find while moving.
  menuFab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 280,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.fab,
  },
  menuFabPressed: {
    opacity: 0.75,
  },
  // SETTINGS FAB — smaller (44dp) than the recenter/comboio column (56dp)
  // so it visually reads as a secondary entry point, not a primary CTA.
  // Subtle border to match the recenter FAB chrome.
  settingsFab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 350,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.fab,
  },
  settingsFabPressed: {
    opacity: 0.7,
  },
  exploreButtonRow: {
    marginTop: spacing.sm,
  },
  clearRouteRow: {
    marginBottom: spacing.sm,
  },
  // Round 44dp close button replacing the old "Limpar preview" pill. We
  // keep it self-centred horizontally and accent-coloured so it reads as
  // the only top-of-map dismissal control when a preview is showing.
  clearPreviewPill: {
    position: 'absolute',
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.fab,
  },
  clearPreviewPillPressed: {
    opacity: 0.8,
  },
  // Compact card above the INICIAR ROTA button. Shows OSRM-derived metrics
  // (approach distance/eta + route distance/eta) or a "calculando" state.
  previewMetricsCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  previewMetricsText: {
    color: colors.textPrimary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
  },
  previewMetricsErrorText: {
    color: colors.warning,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.xs,
  },
});
