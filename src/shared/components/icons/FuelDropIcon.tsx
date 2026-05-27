import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Teardrop / fuel drop: a circle (bottom half) with a triangular pointed
// top. Built from two overlapping shapes: a circle for the round bottom,
// and a rotated square positioned above so its corner sticks up like the
// drop's tip. Universally read as "liquid / fuel".
export const FuelDropIcon: React.FC<IconProps> = ({ size = 24, color = '#FFFFFF' }) => {
  const stroke = Math.max(1, Math.round(size / 14));
  const circleD = Math.round(size * 0.62);
  const tipD = Math.round(size * 0.42);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }]}
    >
      {/* Pointed top — rotated square; only its top half is visible above
          the circle, forming the drop's tip. We draw the outline by giving
          it a border on two adjacent sides. */}
      <View
        style={[
          styles.tip,
          {
            width: tipD,
            height: tipD,
            top: Math.round(size * 0.05),
            borderTopWidth: stroke,
            borderLeftWidth: stroke,
            borderColor: color,
          },
        ]}
      />
      {/* Round bottom */}
      <View
        style={[
          styles.circle,
          {
            width: circleD,
            height: circleD,
            borderRadius: circleD / 2,
            borderColor: color,
            borderWidth: stroke,
            bottom: Math.round(size * 0.08),
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  tip: {
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
    backgroundColor: 'transparent',
  },
  circle: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
});
