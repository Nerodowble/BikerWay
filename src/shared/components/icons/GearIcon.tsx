import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconProps } from './types';

// Settings gear: a hollow ring (outer + inner concentric circles forming the
// rim) with 6 rectangular teeth radiating outward at 60-degree intervals.
// We use absolute-positioned teeth rotated via transform so the icon stays
// purely flexbox/dimension based (no SVG dep). Each tooth is rendered as a
// View with its own rotation; the central hole reads as a gear hub.
const TEETH_ANGLES = [0, 60, 120, 180, 240, 300] as const;

export const GearIcon: React.FC<IconProps> = ({
  size = 24,
  color = '#FFFFFF',
}) => {
  // Outer ring is ~70% of the bounding box so the teeth have room to poke
  // out without clipping the container. The hub is ~22% of the size — large
  // enough to read as a hole, small enough to keep the rim visually solid.
  const ringDiameter = Math.round(size * 0.7);
  const hubDiameter = Math.round(size * 0.22);
  const stroke = Math.max(2, Math.round(size / 10));
  // Each tooth is a thin rectangle anchored on the centre of the container
  // and rotated outward. translateY pushes it from the centre toward the
  // rim so half the tooth body overlaps the ring (no visual gap on the
  // join). Width is narrower than the height to read as a square nub.
  const toothWidth = Math.max(3, Math.round(size * 0.16));
  const toothHeight = Math.max(3, Math.round(size * 0.2));
  const toothOffset = Math.round(ringDiameter / 2);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }]}
    >
      {/* Teeth render first so the ring paints over their inner end and
          hides the part that would otherwise poke into the hub area. */}
      {TEETH_ANGLES.map((deg) => (
        <View
          key={deg}
          style={[
            styles.tooth,
            {
              width: toothWidth,
              height: toothHeight,
              backgroundColor: color,
              transform: [
                { rotate: `${deg}deg` },
                { translateY: -toothOffset },
              ],
            },
          ]}
        />
      ))}
      <View
        style={[
          styles.ring,
          {
            width: ringDiameter,
            height: ringDiameter,
            borderRadius: ringDiameter / 2,
            borderColor: color,
            borderWidth: stroke,
          },
        ]}
      >
        <View
          style={[
            styles.hub,
            {
              width: hubDiameter,
              height: hubDiameter,
              borderRadius: hubDiameter / 2,
              backgroundColor: color,
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
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  hub: {},
  tooth: {
    position: 'absolute',
    borderRadius: 1,
  },
});
