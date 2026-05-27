import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Hamburger menu: 3 evenly spaced horizontal bars. The container is square
// so the icon stays balanced when callers pass a single `size` prop.
export const MenuIcon: React.FC<IconProps> = ({ size = 24, color = '#FFFFFF' }) => {
  // Bar thickness scales with size, but never thinner than 2dp so it stays
  // crisp on low-density screens.
  const barHeight = Math.max(2, Math.round(size / 8));
  // Slight inner padding so the bars never kiss the bounding box.
  const insetH = Math.round(size * 0.1);
  const insetV = Math.round(size * 0.18);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.container,
        {
          width: size,
          height: size,
          paddingHorizontal: insetH,
          paddingVertical: insetV,
        },
      ]}
    >
      <View style={[styles.bar, { height: barHeight, backgroundColor: color }]} />
      <View style={[styles.bar, { height: barHeight, backgroundColor: color }]} />
      <View style={[styles.bar, { height: barHeight, backgroundColor: color }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  bar: {
    width: '100%',
    borderRadius: 1,
  },
});
