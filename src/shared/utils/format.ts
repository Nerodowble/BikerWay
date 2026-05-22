/**
 * Locale-agnostic formatting helpers for distances and durations used in the
 * BikerWay UI. All inputs are sanitized so that NaN / negative / non-finite
 * values degrade gracefully (clamped to zero) — riders should never see "NaN"
 * on the dashboard while moving.
 */

function toNonNegativeFiniteNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value;
}

/**
 * Format a distance expressed in meters.
 * - < 1000 m  → "X m"   (no decimals)
 * - >= 1000 m → "X.X km" (one decimal)
 */
export function formatDistance(meters: number): string {
  const m = toNonNegativeFiniteNumber(meters);
  if (m < 1000) {
    return `${Math.round(m)} m`;
  }
  return `${(m / 1000).toFixed(1)} km`;
}

/**
 * Format a duration expressed in seconds.
 * - < 60   → "Xs"
 * - < 3600 → "X min"
 * - >= 3600 → "Xh Ymin"
 */
export function formatDuration(seconds: number): string {
  const s = toNonNegativeFiniteNumber(seconds);
  if (s < 60) {
    return `${Math.round(s)}s`;
  }
  if (s < 3600) {
    return `${Math.round(s / 60)} min`;
  }
  const hours = Math.floor(s / 3600);
  const minutes = Math.round((s % 3600) / 60);
  return `${hours}h ${minutes}min`;
}

/**
 * Format an integer-rounded kilometer value for compact badges
 * (e.g. autonomy "120 km"). Negative or invalid inputs collapse to "0 km".
 */
export function formatKmWhole(km: number): string {
  const value = Number.isFinite(km) ? Math.round(km) : 0;
  return `${Math.max(0, value)} km`;
}
