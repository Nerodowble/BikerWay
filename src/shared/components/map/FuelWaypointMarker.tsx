import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import type { FuelPoi } from '@/domains/poi/types';
import { colors } from '@/shared/theme';

export interface FuelWaypointMarkerProps {
  waypoint: FuelPoi;
}

/**
 * Highlighted marker for the rider's active fuel detour.
 *
 * Reuses the EXACT minimal shape that finally rendered without clipping for
 * `MotorcycleMarker`: a single round View with NO child content, padded by a
 * transparent outer View, and `tracksViewChanges` permanently true. Adding
 * any child (Text, nested borderRadius View, etc.) consistently caused
 * react-native-maps' Android bitmap snapshot to clip the marker into a
 * "pizza slice" — confirmed across iterations.
 *
 * Differentiation from other markers:
 *   - MotorcycleMarker: orange + smaller (28dp) + chevron-less but the same
 *     family of layout.
 *   - PoiMarker (yellow dots in shortlist): also yellow but only 28dp and
 *     thin dark border, used in big-batch FlatList renders.
 *   - This component: 56dp yellow disc with a THICK white border — clearly
 *     bigger than the shortlist dots so the rider spots their active detour
 *     at a glance, while reusing the proven render-safe structure.
 */
export const FuelWaypointMarker: React.FC<FuelWaypointMarkerProps> = ({
  waypoint,
}) => {
  return (
    <Marker
      coordinate={{
        latitude: waypoint.latitude,
        longitude: waypoint.longitude,
      }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges
      zIndex={900}
    >
      <View style={styles.padding}>
        <View style={styles.disc} />
      </View>
      <Callout tooltip>
        <View style={styles.callout}>
          <Text style={styles.calloutTitle} numberOfLines={2}>
            {waypoint.name}
          </Text>
          <Text style={styles.calloutSub}>Parada de combustível na rota</Text>
        </View>
      </Callout>
    </Marker>
  );
};

const styles = StyleSheet.create({
  padding: {
    padding: 12,
    backgroundColor: 'transparent',
  },
  disc: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.warning,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  callout: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    padding: 10,
    minWidth: 180,
    maxWidth: 240,
    borderWidth: 1,
    borderColor: colors.border,
  },
  calloutTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  calloutSub: {
    color: colors.textSecondary,
    fontSize: 12,
  },
});
