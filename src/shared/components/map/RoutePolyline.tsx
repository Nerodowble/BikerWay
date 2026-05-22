import React from 'react';
import { Polyline } from 'react-native-maps';
import type { RouteCoordinate } from '@/domains/routing/types';
import { colors } from '@/shared/theme';

export interface RoutePolylineProps {
  coordinates: RouteCoordinate[];
  color?: string;
  strokeWidth?: number;
}

/**
 * Renders the routed path as a polyline overlay. We bail out on degenerate
 * inputs (fewer than two coordinates) because react-native-maps will warn
 * and some platforms render visual artifacts otherwise.
 */
export const RoutePolyline: React.FC<RoutePolylineProps> = ({
  coordinates,
  color,
  strokeWidth,
}) => {
  if (!coordinates || coordinates.length < 2) {
    return null;
  }

  return (
    <Polyline
      coordinates={coordinates}
      strokeColor={color ?? colors.accent}
      strokeWidth={strokeWidth ?? 6}
      lineCap="round"
      lineJoin="round"
      zIndex={5}
    />
  );
};
