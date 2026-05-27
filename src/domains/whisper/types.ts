/**
 * F35.9 — Comboio Whisper. Boletim P2P efemero de condicoes da estrada.
 *
 * Cada `WhisperReport` e uma observacao curta (preset escolhido + posicao
 * + tempo). Roda por canal de PeerJS por rota_id (ou loopback pro modo
 * standalone). Anti-abuso vive no proprio domain (funcoes puras) e regras
 * sao verificadas antes do envio pelo store.
 */

export type WhisperKind =
  | 'neblina'
  | 'chuva'
  | 'posto_fechado'
  | 'buraco_brita'
  | 'policial';

export interface WhisperPreset {
  kind: WhisperKind;
  emoji: string;
  label: string;
  /** Frase curta usada na lista pra dar contexto natural ("Neblina forte"). */
  shortText: string;
}

export const WHISPER_PRESETS: ReadonlyArray<WhisperPreset> = [
  { kind: 'neblina', emoji: '🌫️', label: 'NEBLINA', shortText: 'Neblina forte' },
  { kind: 'chuva', emoji: '🌧️', label: 'PISTA MOLHADA', shortText: 'Pista molhada' },
  {
    kind: 'posto_fechado',
    emoji: '⛽',
    label: 'POSTO FECHADO',
    shortText: 'Posto fechado',
  },
  {
    kind: 'buraco_brita',
    emoji: '🪨',
    label: 'BURACO/BRITA',
    shortText: 'Buraco ou brita no acostamento',
  },
  {
    kind: 'policial',
    emoji: '🚨',
    label: 'ALERTA POLICIAL',
    shortText: 'Alerta policial',
  },
];

export function presetByKind(kind: WhisperKind): WhisperPreset {
  const found = WHISPER_PRESETS.find((p) => p.kind === kind);
  return (
    found ?? {
      kind,
      emoji: '⚠️',
      label: 'AVISO',
      shortText: 'Aviso',
    }
  );
}

export interface WhisperReport {
  /** Id local + remoto. Gerado pelo emissor (rota_id+timestamp+random).
   *  Receiver dedupa por id pra evitar processar broadcast duplicado. */
  id: string;
  rotaId: string;
  kind: WhisperKind;
  /** Coordenadas onde o piloto estava ao reportar. */
  latitude: number;
  longitude: number;
  /** Aproximacao do km atual da rota (0-N). Calculado pelo emissor a
   *  partir do progress do GPS no polyline. Apenas display — anti-abuso
   *  usa coords. */
  routeKm?: number;
  /** Epoch ms — quando o reporte foi criado. TTL e checado contra `now`. */
  createdAt: number;
  /** Apelido livre (max 20 chars). Default '@piloto'. Sem identidade real. */
  reporterAlias: string;
}

/** Default TTL: 6 horas (do brainstorm). Reports mais antigos sao
 *  descartados ao receber e nao aparecem na lista. */
export const WHISPER_TTL_MS = 6 * 60 * 60 * 1000;

/** Janela de dedup: dois reports do mesmo `kind` no mesmo km (raio 1km)
 *  dentro de 30 min sao tratados como duplicata. */
export const WHISPER_DEDUP_WINDOW_MS = 30 * 60 * 1000;
export const WHISPER_DEDUP_RADIUS_M = 1000;

/** Geocerca: pra reportar, o piloto precisa ter estado dentro do raio
 *  500m da polyline da rota nos ultimos 30 min. Vinha do brainstorm. */
export const WHISPER_GEOFENCE_RADIUS_M = 500;
export const WHISPER_GEOFENCE_WINDOW_MS = 30 * 60 * 1000;

/** Limite maximo de chars de aliases (UI ja limita; defense in depth). */
export const WHISPER_ALIAS_MAX_LEN = 20;
