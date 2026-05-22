import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Callout, Marker } from 'react-native-maps';
import type { FilteredFuelPoi } from '@/domains/poi/geometry';
import { colors, radius, spacing, typography } from '@/shared/theme';

export interface PoiMarkerProps {
  poi: FilteredFuelPoi;
  selected?: boolean;
  onPress?: (poi: FilteredFuelPoi) => void;
}

const BASE_SIZE_DP = 28;
const SELECTED_SIZE_DP = 36;
const INNER_DOT_DP = 8;
const TRACKS_VIEW_CHANGES_WINDOW_MS = 1500;

/**
 * Fuel-station POI marker. Renders a yellow disc with a dark border and a
 * centered dark inner dot — visually distinct from both the rider's
 * MotorcycleMarker (orange disc) and the DestinationMarker (red pin) so a
 * glance is enough to tell them apart while riding.
 *
 * tracksViewChanges strategy:
 *   - We enable tracksViewChanges on mount (so the freshly-rendered native
 *     marker reflects the React tree) and disable it after a short window
 *     (1.5s). Keeping it on indefinitely makes the map repaint every frame
 *     once you have a handful of markers, which kills battery and frame rate.
 *   - When `selected` flips we briefly re-enable tracking so the larger /
 *     differently-bordered visual is picked up by the native layer.
 */
export const PoiMarker: React.FC<PoiMarkerProps> = ({
  poi,
  selected = false,
  onPress,
}) => {
  const [tracksToggle, setTracksToggle] = useState<boolean>(true);

  useEffect(() => {
    setTracksToggle(true);
    const handle = setTimeout(() => {
      setTracksToggle(false);
    }, TRACKS_VIEW_CHANGES_WINDOW_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [selected]);

  const size = selected ? SELECTED_SIZE_DP : BASE_SIZE_DP;
  const borderColor = selected ? colors.accent : '#121212';

  return (
    <Marker
      coordinate={{ latitude: poi.latitude, longitude: poi.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksToggle}
      onPress={() => onPress?.(poi)}
      zIndex={500}
    >
      <View style={styles.padding}>
        <View
          style={[
            styles.disc,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor,
            },
          ]}
        >
          <View style={styles.innerDot} />
        </View>
      </View>
      <Callout tooltip>
        <View style={styles.callout}>
          <Text style={styles.calloutName} numberOfLines={2}>
            {poi.name}
          </Text>
          <Text style={styles.calloutDistance} numberOfLines={1}>
            {`${Math.round(poi.distanceFromUserMeters)} m`}
          </Text>
        </View>
      </Callout>
    </Marker>
  );
};

const styles = StyleSheet.create({
  padding: {
    padding: 6,
    backgroundColor: 'transparent',
  },
  disc: {
    backgroundColor: colors.warning,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerDot: {
    width: INNER_DOT_DP,
    height: INNER_DOT_DP,
    borderRadius: INNER_DOT_DP / 2,
    backgroundColor: '#121212',
  },
  callout: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 220,
  },
  calloutName: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
  calloutDistance: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    marginTop: 2,
  },
});
