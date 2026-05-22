import React from 'react';
import { Polyline } from 'react-native-maps';
import type { WeatherSegment } from '@/domains/weather/types';

export interface WeatherSegmentPolylineProps {
  segment: WeatherSegment;
}

/**
 * Visual contract for weather overlays on top of the route polyline.
 *
 * Why the colours are hard-coded here (instead of `colors.warning` /
 * `colors.danger` from the theme): the map overlay needs to remain LEGIBLE
 * on top of both light and dark basemaps, and the warning yellow / danger
 * red used by the StatusBadge chrome is tuned for surface contrast on dark
 * UI panels, not for raster tiles. The values below are picked to pop on
 * both tile modes.
 */
const WARNING_COLOR = '#FFCC00';
const DANGER_COLOR = '#FF3B30';
/**
 * Stroke widths SIT ON TOP of the base RoutePolyline (which is 6px). We
 * intentionally render the weather overlay wider so the rider sees a halo
 * of bad-weather colour even when the base polyline is sitting underneath.
 */
const WARNING_STROKE_WIDTH = 8;
const DANGER_STROKE_WIDTH = 10;
/**
 * Dash pattern for the danger overlay: a 5-on/5-off pattern visually
 * communicates "alert / take action" without obscuring the route geometry
 * underneath. The warning overlay stays solid because yellow on orange is
 * already low-contrast — adding dashes there hurts readability.
 */
const DANGER_DASH_PATTERN = [5, 5];
/**
 * Z-order: the base RoutePolyline lives at zIndex 5; we draw above so the
 * coloured halo wins visually. We also stack danger above warning so an
 * isolated red trecho remains visible even when it overlaps a yellow one
 * (edge case at severity transitions).
 */
const WARNING_Z_INDEX = 6;
const DANGER_Z_INDEX = 7;

/**
 * Renders a single weather-tinted segment of the route polyline.
 *
 * We render NOTHING when the segment severity is 'ok' — the base route
 * polyline already paints that stretch in the brand accent colour, and an
 * extra polyline on top would either dull the accent (transparency) or
 * waste GPU cycles drawing the same pixels twice. Skipping also keeps the
 * "where is the bad weather?" affordance crisp: every coloured pixel on
 * top of the route maps 1:1 to a warning/danger trecho.
 *
 * Degenerate guards mirror {@link RoutePolyline} — fewer than 2 coords is
 * not a renderable polyline on react-native-maps.
 */
export const WeatherSegmentPolyline: React.FC<WeatherSegmentPolylineProps> = ({
  segment,
}) => {
  if (segment.severity === 'ok') {
    return null;
  }
  if (!segment.coordinates || segment.coordinates.length < 2) {
    return null;
  }

  const isDanger = segment.severity === 'danger';
  const strokeColor = isDanger ? DANGER_COLOR : WARNING_COLOR;
  const strokeWidth = isDanger ? DANGER_STROKE_WIDTH : WARNING_STROKE_WIDTH;
  const zIndex = isDanger ? DANGER_Z_INDEX : WARNING_Z_INDEX;
  // `lineDashPattern` is iOS+Android on react-native-maps 1.x. We pass a
  // single-element [0] for solid lines (instead of undefined) so the prop
  // is always present — this avoids a known platform quirk where toggling
  // from undefined -> [5,5] -> undefined can leave a stale dash pattern.
  const lineDashPattern = isDanger ? DANGER_DASH_PATTERN : [0];

  return (
    <Polyline
      coordinates={segment.coordinates}
      strokeColor={strokeColor}
      strokeWidth={strokeWidth}
      lineCap="round"
      lineJoin="round"
      lineDashPattern={lineDashPattern}
      zIndex={zIndex}
    />
  );
};
