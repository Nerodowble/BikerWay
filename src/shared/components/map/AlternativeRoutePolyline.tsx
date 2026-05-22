import React from 'react';
import { Polyline } from 'react-native-maps';
import type { RouteCoordinate } from '@/domains/routing/types';

export interface AlternativeRoutePolylineProps {
  coordinates: RouteCoordinate[];
  /**
   * Stroke colour for this alternative. Required — the multi-route picker
   * assigns a distinct colour per alternative so the rider can match the
   * map polyline to the card in the bottom sheet.
   */
  color: string;
  /**
   * Optional base stroke width for the un-selected state. Defaults to 8 so
   * the lines remain readable on a busy basemap. When `selected` is true
   * the rendered width is `strokeWidth * 1.75` (so 8 -> 14 by default)
   * which makes the picked alternative pop above the others.
   */
  strokeWidth?: number;
  /**
   * Whether this alternative is the currently selected one. The selected
   * polyline is rendered thicker and at a higher zIndex so it visually
   * stands out from the un-selected siblings.
   */
  selected?: boolean;
}

const DEFAULT_STROKE_WIDTH = 8;
const SELECTED_STROKE_MULTIPLIER = 1.75;
const BASE_Z_INDEX = 4;
const SELECTED_Z_INDEX = 6;

/**
 * Renders a single OSRM alternative as a coloured polyline on the map.
 *
 * Mirrors {@link RoutePolyline} but accepts an explicit colour and a
 * `selected` flag. We bail out on degenerate inputs (fewer than two
 * coordinates) because react-native-maps will warn and some platforms
 * render visual artifacts otherwise. The polyline is intentionally drawn
 * BELOW the main RoutePolyline (zIndex 5) when un-selected, and ABOVE it
 * when selected, so the rider always sees the chosen route on top.
 */
export const AlternativeRoutePolyline: React.FC<AlternativeRoutePolylineProps> = ({
  coordinates,
  color,
  strokeWidth,
  selected,
}) => {
  if (!coordinates || coordinates.length < 2) {
    return null;
  }

  const base = strokeWidth ?? DEFAULT_STROKE_WIDTH;
  // When the alternative is selected we widen the stroke noticeably (default
  // 8 -> 14) so the picked option dominates the screen. The multiplier is
  // applied as a float and rounded so the user sees crisp pixel snapping.
  const width = selected ? Math.round(base * SELECTED_STROKE_MULTIPLIER) : base;

  return (
    <Polyline
      coordinates={coordinates}
      strokeColor={color}
      strokeWidth={width}
      lineCap="round"
      lineJoin="round"
      zIndex={selected ? SELECTED_Z_INDEX : BASE_Z_INDEX}
    />
  );
};
