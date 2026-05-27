import type { CatalogRoute } from '../catalog/types';
import type { TripHistoryEntry } from '../rideHistory/types';

/**
 * F35.3 — Stamps Brasil. Estruturas que a tela do Passaporte consome.
 *
 * `Badge` representa uma conquista pre-definida (hardcoded). O catalogo
 * comeca com ~10 mas crescer e so adicionar mais regras em
 * `domains/passport/badges.ts`.
 *
 * `PassportData` e o agregado completo que a tela renderiza — vem do
 * passportStore por loadPassport(), que internamente lê trips do
 * SQLite e cruza com o catalogo + perfil do piloto.
 */

export type BadgeId =
  | 'first-route'
  | 'south-east-conqueror'
  | 'south-conqueror'
  | 'coast-master'
  | 'mountain-five-of-year'
  | 'early-bird'
  | 'marathoner'
  | 'veteran'
  | 'anniversary'
  | 'two-states-day';

export interface Badge {
  id: BadgeId;
  /** Icone curto pro card. Emoji pra simplicidade — sem dependencia de
   *  asset library. */
  icon: string;
  title: string;
  description: string;
  /** Quando essa badge foi desbloqueada (epoch ms). Para badges nao
   *  desbloqueadas, e undefined. */
  unlockedAt?: number;
  /** Progresso atual rumo ao unlock (0..1). Util pra mostrar "5/10 trips
   *  para Veterano". Badges atemicos (ja unlock ou nao) tem 0 ou 1. */
  progress: number;
}

export interface StateProgress {
  uf: string;
  completed: number;
  total: number;
}

export interface PassportStats {
  trips: number;
  km: number;
  uniqueStates: number;
  /** Ano corrente pro card "X rotas em 2026". */
  currentYear: number;
  tripsInCurrentYear: number;
}

export interface RouteTripCard {
  trip: TripHistoryEntry;
  route?: CatalogRoute;
}

export interface PassportData {
  stats: PassportStats;
  perState: StateProgress[];
  badges: Badge[];
  history: RouteTripCard[];
}
