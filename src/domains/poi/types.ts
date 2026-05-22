/**
 * POI category identifiers used across the Overpass client, the POI store,
 * and the UI sheet. Adding a new category requires a matching query branch
 * in `overpassClient.buildQuery` and a chip in `PoiListSheet`.
 *
 * - 'fuel'    : gas stations (OSM `amenity=fuel`)
 * - 'tyres'   : tyre shops / repair (OSM `shop=tyres` / `shop=tire_repair` /
 *               `craft=tyres`)
 * - 'mechanic': motorcycle / general mechanic workshops (OSM
 *               `shop=motorcycle_repair` / `shop=motorcycle` /
 *               `amenity=motorcycle_repair` / `shop=car_repair` as fallback)
 */
export type PoiCategory = 'fuel' | 'tyres' | 'mechanic';

export interface PointOfInterest {
  id: string;
  category: PoiCategory;
  name: string;
  latitude: number;
  longitude: number;
  distanceFromUserMeters?: number;
  distanceToRouteMeters?: number;
}

/**
 * Generic POI shape returned by the Overpass client regardless of category.
 * Optional OSM-derived metadata fields are shared by all categories because
 * `brand` / `operator` / `opening_hours` are common across `amenity=fuel`,
 * `shop=tyres` and `shop=motorcycle_repair` in OSM.
 */
export interface Poi extends PointOfInterest {
  brand?: string;        // OSM `brand=*`
  operator?: string;     // OSM `operator=*`
  openingHours?: string; // OSM `opening_hours=*` (raw text)
}

/**
 * Kept as a narrowed alias of `Poi` so existing call-sites that imported
 * `FuelPoi` continue to compile without changes. Anything typed as `FuelPoi`
 * is now structurally a `Poi` whose category may be any `PoiCategory` — the
 * historic 'fuel'-only narrowing was removed when the sheet started serving
 * tyre shops and mechanic workshops via the same pipeline.
 */
export type FuelPoi = Poi;

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}
