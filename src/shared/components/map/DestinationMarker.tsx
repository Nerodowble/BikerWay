import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Callout, Marker } from 'react-native-maps';
import type { GeoPosition } from '@/domains/navigation/types';
import { colors, spacing, radius } from '@/shared/theme';

export interface DestinationMarkerProps {
  position: GeoPosition;
  label?: string;
}

/**
 * Marker rendered at the routing destination.
 *
 * Anchor is bottom-center so the tip of the triangle sits exactly on the
 * geographic coordinate. The optional `label` is shown via a Callout, which
 * the user has to tap to open (we keep this off by default to avoid
 * distracting the rider while moving).
 */
export const DestinationMarker: React.FC<DestinationMarkerProps> = ({
  position,
  label,
}) => {
  return (
    <Marker
      coordinate={{
        latitude: position.latitude,
        longitude: position.longitude,
      }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
    >
      <View style={styles.pinContainer}>
        <View style={styles.circle}>
          <View style={styles.innerDot} />
        </View>
        <View style={styles.triangle} />
      </View>
      {label ? (
        <Callout tooltip>
          <View style={styles.callout}>
            <Text style={styles.calloutText} numberOfLines={2}>
              {label}
            </Text>
          </View>
        </Callout>
      ) : null}
    </Marker>
  );
};

const PIN_SIZE = 28;

const styles = StyleSheet.create({
  pinContainer: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  circle: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.danger,
    marginTop: -2,
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
  calloutText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
});
