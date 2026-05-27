import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Gas pump: a tall body (vertical rectangle) with a wider base, a small
// horizontal "display" strip near the top, and a short nozzle arm jutting
// out to the right. Pure flexbox — body is centred horizontally and the
// nozzle is absolutely positioned to its right edge.
export const GasPumpIcon: React.FC<IconProps> = ({ size = 24, color = '#FFFFFF' }) => {
  const bodyW = Math.round(size * 0.46);
  const bodyH = Math.round(size * 0.74);
  const baseW = Math.round(size * 0.62);
  const baseH = Math.max(2, Math.round(size * 0.1));
  const displayW = Math.round(bodyW * 0.6);
  const displayH = Math.max(2, Math.round(size * 0.08));
  const nozzleW = Math.round(size * 0.16);
  const nozzleH = Math.round(size * 0.18);
  const stroke = Math.max(1, Math.round(size / 18));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }]}
    >
      <View
        style={[
          styles.body,
          {
            width: bodyW,
            height: bodyH,
            borderColor: color,
            borderWidth: stroke,
            borderRadius: Math.round(size * 0.06),
          },
        ]}
      >
        <View
          style={[
            styles.display,
            {
              width: displayW,
              height: displayH,
              backgroundColor: color,
              marginTop: Math.round(size * 0.08),
            },
          ]}
        />
      </View>
      {/* Nozzle arm sticking out the right of the body, top portion */}
      <View
        style={[
          styles.nozzle,
          {
            width: nozzleW,
            height: nozzleH,
            borderColor: color,
            borderWidth: stroke,
            top: Math.round(size * 0.15),
            left: Math.round(size * 0.5 + bodyW / 2 - stroke),
          },
        ]}
      />
      <View
        style={[
          styles.base,
          {
            width: baseW,
            height: baseH,
            backgroundColor: color,
            bottom: Math.round(size * 0.06),
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
  body: {
    alignItems: 'center',
    marginBottom: 0,
  },
  display: {
    borderRadius: 1,
  },
  nozzle: {
    position: 'absolute',
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  base: {
    position: 'absolute',
    borderRadius: 1,
  },
});
