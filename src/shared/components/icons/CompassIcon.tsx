import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Compass: a circular outline with a slim diagonal needle inside. The
// needle is a thin rotated rectangle; we tint only the top half darker
// (via a small bar overlay) to suggest "north" without needing two
// triangles. Keeps the icon readable at 18-22dp.
export const CompassIcon: React.FC<IconProps> = ({ size = 24, color = '#FFFFFF' }) => {
  const ringD = Math.round(size * 0.86);
  const stroke = Math.max(1, Math.round(size / 14));
  const needleH = Math.round(size * 0.6);
  const needleW = Math.max(2, Math.round(size / 8));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }]}
    >
      <View
        style={[
          styles.ring,
          {
            width: ringD,
            height: ringD,
            borderRadius: ringD / 2,
            borderColor: color,
            borderWidth: stroke,
          },
        ]}
      >
        <View
          style={[
            styles.needle,
            {
              width: needleW,
              height: needleH,
              backgroundColor: color,
              transform: [{ rotate: '45deg' }],
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  needle: {
    borderRadius: 1,
  },
});
