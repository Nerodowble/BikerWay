import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Classic map pin: a circular head with a triangular tail pointing down.
// The head is a rounded circle outline, the tail is a rotated square
// peeking below the circle so its corner forms the pin's point.
export const MapPinIcon: React.FC<IconProps> = ({ size = 24, color = '#FFFFFF' }) => {
  const stroke = Math.max(1, Math.round(size / 14));
  const headD = Math.round(size * 0.58);
  const innerD = Math.max(2, Math.round(size * 0.14));
  const tailD = Math.round(size * 0.34);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }]}
    >
      <View
        style={[
          styles.head,
          {
            width: headD,
            height: headD,
            borderRadius: headD / 2,
            borderColor: color,
            borderWidth: stroke,
            top: Math.round(size * 0.04),
          },
        ]}
      >
        <View
          style={[
            styles.inner,
            {
              width: innerD,
              height: innerD,
              borderRadius: innerD / 2,
              backgroundColor: color,
            },
          ]}
        />
      </View>
      <View
        style={[
          styles.tail,
          {
            width: tailD,
            height: tailD,
            top: Math.round(size * 0.42),
            borderRightWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
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
  head: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  inner: {},
  tail: {
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
    backgroundColor: 'transparent',
  },
});
