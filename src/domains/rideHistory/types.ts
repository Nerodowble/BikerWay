/**
 * F35.1 — Tipos do dominio de historico de rotas + viagens.
 *
 * `RouteHistoryEvent` cobre interacoes leves (abriu o detail, comecou a
 * navegacao). E o feed pro ranker de novidade (F35.5).
 *
 * `TripHistoryEntry` cobre viagens INICIADAS (started_at sempre preenchido).
 * `completed_at` so vira nao-null quando F35.2 detectar que o piloto cobriu
 * >=80% da polyline. F35.3 (Stamps) le essa tabela ja com `completed_at`
 * filtrado pra montar o passaporte.
 */

export type RouteHistoryAction = 'opened' | 'started';

export interface RouteHistoryEvent {
  id: number;
  rotaId: string;
  action: RouteHistoryAction;
  occurredAt: number;
}

export interface TripHistoryEntry {
  id: number;
  rotaId: string;
  startedAt: number;
  completedAt?: number;
  durationMinutes?: number;
  distanceKm?: number;
  notes?: string;
}
