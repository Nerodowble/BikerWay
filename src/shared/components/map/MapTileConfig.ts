/**
 * Tile source configuration for the BikerWay map.
 *
 * Strategy: OpenStreetMap-derived raster tiles served via CartoDB's free
 * Basemaps CDN (zero licensing cost, no API key). We chose CartoDB over
 * `tile.openstreetmap.org` because the OSMF Tile Usage Policy explicitly
 * forbids embedding the public tile server in mobile apps — the OSM tile
 * server starts returning HTTP 418/403 "App not following the tile usage
 * policy of OpenStreetMaps" once it detects an app-shaped User-Agent.
 *
 * CartoDB's tiles are free for use with attribution to BOTH OpenStreetMap
 * and CARTO; the attribution row inside `BikerMapView` shows the required
 * credit on every render.
 *
 * Tile choice (light vs dark) is auto-driven by local time of day.
 */

// CartoDB Positron — soft, low-contrast LIGHT basemap. Reads well in daylight
// without competing with the moto's overlay UI.
export const OSM_TILE_TEMPLATE =
  'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

// CartoDB Dark Matter — high-contrast DARK basemap. The accent route polyline
// pops vividly on top at night.
export const OSM_DARK_TILE_TEMPLATE =
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

// Both styles require attribution to OSM (data) AND CARTO (rendering).
export const TILE_ATTRIBUTION_LIGHT = '© OpenStreetMap · © CARTO';
export const TILE_ATTRIBUTION_DARK = '© OpenStreetMap · © CARTO';

/**
 * Decide whether the dark basemap should be used right now.
 *
 * Default heuristic: night = 18:00 → 06:00 (local device time).
 * Callers may override via `forceMode` if they want a manual toggle later.
 */
export type TileMode = 'light' | 'dark' | 'auto';

export function isNightHour(date: Date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 18 || hour < 6;
}

export interface ResolvedTile {
  template: string;
  attribution: string;
  isDark: boolean;
}

export function resolveTileMode(
  mode: TileMode = 'auto',
  now: Date = new Date(),
): ResolvedTile {
  const useDark =
    mode === 'dark' || (mode === 'auto' && isNightHour(now));
  return useDark
    ? {
        template: OSM_DARK_TILE_TEMPLATE,
        attribution: TILE_ATTRIBUTION_DARK,
        isDark: true,
      }
    : {
        template: OSM_TILE_TEMPLATE,
        attribution: TILE_ATTRIBUTION_LIGHT,
        isDark: false,
      };
}

// Back-compat — older code referenced TILE_ATTRIBUTION as a single string.
export const TILE_ATTRIBUTION = TILE_ATTRIBUTION_LIGHT;
