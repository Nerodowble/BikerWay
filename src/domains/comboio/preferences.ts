/**
 * F34.0 — Preferências do Comboio. Set-and-forget (set uma vez, vale pra
 * sempre). Persistidas em `app_settings` key-value. Defaults seguem o
 * brainstorm: features que mudam visual default OFF (replay, km/h);
 * features que ajudam awareness default ON (parados, separação, rota
 * oficial, cross-path).
 */

export interface ComboioPreferences {
  /** 🎥 Gravar replay de viagens. F34.10 só persiste se isto for true. */
  recordReplay: boolean;
  /** ⚡ Mostrar km/h abaixo de cada pin no mapa. */
  showSpeedOnPin: boolean;
  /** ⏸️ Destacar peers parados (velocidade < 5 km/h por > 30s). */
  highlightStopped: boolean;
  /** ⚠️ Alertas de separação (par > 3 km por > 3 min). */
  alertSeparation: boolean;
  /** 🛣️ Mostrar polyline azul tracejada da rota oficial do admin. */
  showOfficialRoute: boolean;
  /** 🔀 Banner "cruzou trajeto. Seguir junto?" quando peer atinge < 200m
   *  da polyline oficial. */
  crossPathBanner: boolean;
}

export const DEFAULT_COMBOIO_PREFERENCES: ComboioPreferences = {
  recordReplay: false,
  showSpeedOnPin: false,
  highlightStopped: true,
  alertSeparation: true,
  showOfficialRoute: true,
  crossPathBanner: true,
};

/** Chaves SQLite no `app_settings`. Prefixo `comboio.` evita colisão com
 *  outras keys (trip.distanceKm, trip.anchorPos do navigationStore). */
export const COMBOIO_PREF_KEYS: Record<keyof ComboioPreferences, string> = {
  recordReplay: 'comboio.recordReplay',
  showSpeedOnPin: 'comboio.showSpeedOnPin',
  highlightStopped: 'comboio.highlightStopped',
  alertSeparation: 'comboio.alertSeparation',
  showOfficialRoute: 'comboio.showOfficialRoute',
  crossPathBanner: 'comboio.crossPathBanner',
};

/** Parse defensivo: aceita "1"/"0", "true"/"false". Default em caso de
 *  valor inválido (preservação do default mais conservador). */
export function parseBoolPref(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === null || raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return fallback;
}
