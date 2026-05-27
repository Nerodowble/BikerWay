import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Chat bubble: rounded square body + a small triangular "tail" anchored to
// the bottom-left corner. The triangle is a zero-size View leveraging the
// CSS border trick (transparent borders form a triangle).
// Picked over concentric waves because the bubble immediately reads as
// "voice/chat", which matches the COMBOIO action (group voice channel).
export const ComboioIcon: React.FC<IconProps> = ({ size = 24, color = '#FFFFFF' }) => {
  const bodySize = Math.round(size * 0.78);
  const tailSize = Math.max(4, Math.round(size * 0.22));
  const dotSize = Math.max(2, Math.round(size / 10));
  // 3 small dots inside the bubble to suggest typing / active chatter.
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }]}
    >
      <View
        style={[
          styles.bubble,
          {
            width: bodySize,
            height: bodySize * 0.78,
            borderRadius: Math.round(bodySize * 0.22),
            borderColor: color,
          },
        ]}
      >
        <View style={[styles.dot, { width: dotSize, height: dotSize, backgroundColor: color }]} />
        <View style={[styles.dot, { width: dotSize, height: dotSize, backgroundColor: color }]} />
        <View style={[styles.dot, { width: dotSize, height: dotSize, backgroundColor: color }]} />
      </View>
      <View
        style={[
          styles.tail,
          {
            left: Math.round(size * 0.18),
            bottom: Math.round(size * 0.06),
            borderTopWidth: tailSize,
            borderRightWidth: tailSize,
            borderTopColor: color,
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
  bubble: {
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: 4,
  },
  dot: {
    borderRadius: 999,
  },
  tail: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderRightColor: 'transparent',
  },
});
