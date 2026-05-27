import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Close (X): two centred bars rotated +45 / -45 degrees. We anchor them at
// the parent's centre with absolute positioning so the rotation pivot is
// guaranteed to be the geometric middle of the icon (otherwise the bars
// drift on Android due to flexbox + transform-origin interactions).
export const CloseIcon: React.FC<IconProps> = ({ size = 24, color = '#FFFFFF' }) => {
  const thickness = Math.max(2, Math.round(size / 10));
  // Make the bars slightly shorter than the bounding box so the rotated
  // corners do not visually clip on small sizes (the diagonal of a square
  // is longer than its side; we under-shoot to keep the same optical size).
  const length = Math.round(size * 0.82);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }]}
    >
      <View
        style={[
          styles.bar,
          {
            width: length,
            height: thickness,
            backgroundColor: color,
            transform: [{ rotate: '45deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.bar,
          {
            width: length,
            height: thickness,
            backgroundColor: color,
            transform: [{ rotate: '-45deg' }],
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
  bar: {
    position: 'absolute',
    borderRadius: 1,
  },
});
