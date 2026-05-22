import type { WeatherSeverity } from './types';

/**
 * Maps an Open-Meteo WMO weather code (0..99) to a PT-BR human label and a
 * default app severity bucket. The default severity considers ONLY the code
 * itself; use {@link combineSeverity} to escalate based on wind/precipitation.
 *
 * Open-Meteo WMO code reference:
 *   0       Clear sky
 *   1-3     Mainly clear, partly cloudy, overcast
 *   45,48   Fog
 *   51-57   Drizzle (light/moderate/dense, freezing variants)
 *   61-67   Rain (light/moderate/heavy, freezing variants)
 *   71-77   Snow / snow grains
 *   80-82   Rain showers (light/moderate/violent)
 *   85-86   Snow showers
 *   95      Thunderstorm
 *   96,99   Thunderstorm with hail
 *
 * Unknown codes fall back to a neutral "Desconhecido" / 'ok' bucket so the UI
 * stays calm rather than alarming the rider with bogus warnings.
 */
export function describeWeatherCode(code: number): {
  label: string;
  severity: WeatherSeverity;
} {
  // Short labels (<=8 chars) so the "Clima ${label} ${temp}°" badge in the
  // top bar never overflows on narrow phones. Severity bucket unchanged.
  if (code === 0) {
    return { label: 'Limpo', severity: 'ok' };
  }
  if (code >= 1 && code <= 3) {
    return { label: 'Nublado', severity: 'ok' };
  }
  if (code === 45 || code === 48) {
    return { label: 'Neblina', severity: 'warning' };
  }
  if (code >= 51 && code <= 57) {
    return { label: 'Garoa', severity: 'warning' };
  }
  if (code >= 61 && code <= 67) {
    if (code === 65 || code === 67) {
      return { label: 'Chuva+', severity: 'danger' };
    }
    return { label: 'Chuva', severity: 'warning' };
  }
  if (code >= 71 && code <= 77) {
    return { label: 'Neve', severity: 'danger' };
  }
  if (code >= 80 && code <= 82) {
    if (code === 82) {
      return { label: 'Tempo.+', severity: 'danger' };
    }
    return { label: 'Tempo.', severity: 'warning' };
  }
  if (code === 85 || code === 86) {
    return { label: 'Neve+', severity: 'danger' };
  }
  if (code >= 95 && code <= 99) {
    return { label: 'Trovoada', severity: 'danger' };
  }
  return { label: '—', severity: 'ok' };
}

/**
 * Combines the code-based severity with wind/precipitation magnitudes.
 * Escalates to 'danger' when:
 *   - wind speed > 50 km/h (gust threshold the rider should be warned about), or
 *   - precipitation > 5 mm in the last hour (heavy rain regardless of code).
 * Otherwise returns the base severity from {@link describeWeatherCode}.
 */
export function combineSeverity(
  code: number,
  windKmh: number,
  precipMm: number,
): WeatherSeverity {
  const base = describeWeatherCode(code).severity;
  if (windKmh > 50) return 'danger';
  if (precipMm > 5) return 'danger';
  return base;
}
