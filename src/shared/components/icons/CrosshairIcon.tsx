import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Classic crosshair: 4 short ticks at the cardinal directions + a small
// centre dot. Reads as "recenter" / "my location" much faster than a ring
// + dot because the cardinal ticks are a universal map-control mark.
export const CrosshairIcon: React.FC<IconProps> = ({ size = 24, color = '#FFFFFF' }) => {
  const stroke = Math.max(2, Math.round(size / 12));
  const tickLen = Math.round(size * 0.22);
  const dotSize = Math.max(3, Math.round(size / 7));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }]}
    >
      {/* Top tick */}
      <View
        style={[
          styles.vTick,
          {
            top: 0,
            width: stroke,
            height: tickLen,
            backgroundColor: color,
          },
        ]}
      />
      {/* Bottom tick */}
      <View
        style={[
          styles.vTick,
          {
            bottom: 0,
            width: stroke,
            height: tickLen,
            backgroundColor: color,
          },
        ]}
      />
      {/* Left tick */}
      <View
        style={[
          styles.hTick,
          {
            left: 0,
            width: tickLen,
            height: stroke,
            backgroundColor: color,
          },
        ]}
      />
      {/* Right tick */}
      <View
        style={[
          styles.hTick,
          {
            right: 0,
            width: tickLen,
            height: stroke,
            backgroundColor: color,
          },
        ]}
      />
      <View
        style={[
          styles.dot,
          { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  vTick: {
    position: 'absolute',
    borderRadius: 1,
  },
  hTick: {
    position: 'absolute',
    borderRadius: 1,
  },
  dot: {
    position: 'absolute',
  },
});
