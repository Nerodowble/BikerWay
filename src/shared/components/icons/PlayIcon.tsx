import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Play triangle pointing right. Built with the classic zero-width-View +
// asymmetric borders trick: a transparent top/bottom and a coloured left
// border collapse into a rightward-pointing triangle without any SVG.
export const PlayIcon: React.FC<IconProps> = ({ size = 24, color = '#FFFFFF' }) => {
  const triH = Math.round(size * 0.7);
  const triW = Math.round(size * 0.6);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }]}
    >
      <View
        style={[
          styles.triangle,
          {
            borderTopWidth: triH / 2,
            borderBottomWidth: triH / 2,
            borderLeftWidth: triW,
            borderLeftColor: color,
          },
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
  triangle: {
    width: 0,
    height: 0,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightWidth: 0,
    // Nudge optical centre slightly right so the triangle "sits" centred
    // (its visual centre of mass is left of its bounding box centre).
    marginLeft: 2,
  },
});
