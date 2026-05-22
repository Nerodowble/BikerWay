import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '@/shared/theme';

export interface ProgressBarProps {
  percent: number;
  height?: number;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * Thin progress indicator. No animation in Phase 2.5 — the bar is rebuilt
 * from layout each render. Width is expressed as a percentage so the bar
 * adapts to whatever container the caller drops it in.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  percent,
  height = 4,
}) => {
  const safe = clampPercent(percent);
  const fillWidth = `${safe}%` as const;

  return (
    <View
      style={[styles.track, { height }]}
      testID="progress-bar"
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(safe), min: 0, max: 100 }}
    >
      <View style={[styles.fill, { width: fillWidth, height }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
});
