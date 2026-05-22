import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/shared/theme';

export interface ManeuverIconProps {
  instruction: string;
  sizeDp?: number;
  color?: string;
}

type IconShape = 'right' | 'left' | 'uturn' | 'arrive' | 'straight';

function classifyInstruction(instruction: string): IconShape {
  const lower = instruction.toLowerCase();
  if (lower.includes('rotat') || lower.includes('retorno')) {
    return 'uturn';
  }
  if (
    lower.includes('destino') ||
    lower.includes('chegou') ||
    lower.includes('arrive')
  ) {
    return 'arrive';
  }
  if (lower.includes('direita')) {
    return 'right';
  }
  if (lower.includes('esquerda')) {
    return 'left';
  }
  return 'straight';
}

/**
 * Pure-View pictogram used in the maneuver panel. No SVG dependency: every
 * arrow/marker is composed from absolutely-positioned Views so we stay
 * inside the "no new external deps" constraint while still rendering at
 * any pixel density.
 */
export const ManeuverIcon: React.FC<ManeuverIconProps> = ({
  instruction,
  sizeDp = 56,
  color = colors.accent,
}) => {
  const shape = classifyInstruction(instruction);
  const size = sizeDp;
  const stemThickness = Math.max(4, Math.round(size * 0.14));
  const headSize = Math.round(size * 0.45);

  return (
    <View
      style={[styles.frame, { width: size, height: size }]}
      testID="maneuver-icon"
      accessibilityLabel={`maneuver-${shape}`}
    >
      {shape === 'straight' ? (
        <StraightArrow
          size={size}
          color={color}
          stem={stemThickness}
          head={headSize}
        />
      ) : null}
      {shape === 'right' ? (
        <RightArrow
          size={size}
          color={color}
          stem={stemThickness}
          head={headSize}
        />
      ) : null}
      {shape === 'left' ? (
        <LeftArrow
          size={size}
          color={color}
          stem={stemThickness}
          head={headSize}
        />
      ) : null}
      {shape === 'uturn' ? (
        <UTurnArrow
          size={size}
          color={color}
          stem={stemThickness}
          head={headSize}
        />
      ) : null}
      {shape === 'arrive' ? <ArriveMarker size={size} color={color} /> : null}
    </View>
  );
};

interface PartProps {
  size: number;
  color: string;
  stem: number;
  head: number;
}

const StraightArrow: React.FC<PartProps> = ({ size, color, stem, head }) => {
  const stemHeight = size * 0.6;
  return (
    <>
      <View
        style={{
          position: 'absolute',
          left: (size - stem) / 2,
          top: size - stemHeight - 4,
          width: stem,
          height: stemHeight,
          backgroundColor: color,
          borderRadius: stem / 2,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: (size - head * 1.6) / 2,
          top: size - stemHeight - head * 0.7,
          width: 0,
          height: 0,
          borderLeftWidth: head * 0.8,
          borderRightWidth: head * 0.8,
          borderBottomWidth: head,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
        }}
      />
    </>
  );
};

const RightArrow: React.FC<PartProps> = ({ size, color, stem, head }) => {
  const stemWidth = size * 0.55;
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: (size - stem) / 2,
          left: 4,
          width: stemWidth,
          height: stem,
          backgroundColor: color,
          borderRadius: stem / 2,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: (size - head * 1.6) / 2,
          left: 4 + stemWidth - head * 0.3,
          width: 0,
          height: 0,
          borderTopWidth: head * 0.8,
          borderBottomWidth: head * 0.8,
          borderLeftWidth: head,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: color,
        }}
      />
    </>
  );
};

const LeftArrow: React.FC<PartProps> = ({ size, color, stem, head }) => {
  const stemWidth = size * 0.55;
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: (size - stem) / 2,
          right: 4,
          width: stemWidth,
          height: stem,
          backgroundColor: color,
          borderRadius: stem / 2,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: (size - head * 1.6) / 2,
          right: 4 + stemWidth - head * 0.3,
          width: 0,
          height: 0,
          borderTopWidth: head * 0.8,
          borderBottomWidth: head * 0.8,
          borderRightWidth: head,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderRightColor: color,
        }}
      />
    </>
  );
};

/**
 * U-turn fallback: rounded "loop" hinted by a thick ring plus a left-pointing
 * head. The spec allows degrading to a simple shape if a true omega is too
 * complex without SVG — we render a ring + left arrow which reads as
 * "go back" while staying entirely View-based.
 */
const UTurnArrow: React.FC<PartProps> = ({ size, color, stem, head }) => {
  const ring = size * 0.7;
  const ringThickness = Math.max(4, Math.round(size * 0.1));
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: (size - ring) / 2 - size * 0.08,
          left: (size - ring) / 2,
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderTopWidth: ringThickness,
          borderLeftWidth: ringThickness,
          borderRightWidth: ringThickness,
          borderBottomWidth: 0,
          borderTopColor: color,
          borderLeftColor: color,
          borderRightColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: (size - ring) / 2 - 2,
          top: size * 0.55,
          width: 0,
          height: 0,
          borderTopWidth: head * 0.6,
          borderBottomWidth: head * 0.6,
          borderRightWidth: head * 0.9,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderRightColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: (size - ring) / 2 + ringThickness / 2,
          top: size * 0.55 + head * 0.6 - stem / 2,
          width: ring / 2 - ringThickness,
          height: stem,
          backgroundColor: color,
          borderRadius: stem / 2,
        }}
      />
    </>
  );
};

const ArriveMarker: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => {
  const outer = size * 0.7;
  const inner = size * 0.32;
  const ringThickness = Math.max(4, Math.round(size * 0.08));
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: (size - outer) / 2,
          left: (size - outer) / 2,
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: ringThickness,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: (size - inner) / 2,
          left: (size - inner) / 2,
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: color,
        }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
