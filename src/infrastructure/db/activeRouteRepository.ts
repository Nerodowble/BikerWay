import * as SQLite from 'expo-sqlite';
import { initDatabase } from './sqlite';
import type { Route } from '@/domains/routing/types';
import type { GeoPosition } from '@/domains/navigation/types';

/**
 * F36.1 — Persistencia da rota ATIVA (a que esta sendo navegada). Permite
 * sobreviver a kill do app + reabertura sem rede. O `navigationStore`
 * salva via `setActiveRoute(route)` e limpa via `setActiveRoute(null)` ou
 * `stopNavigation()`. O bootstrap re-hidrata.
 *
 * Estrategia de serializacao: JSON.stringify do Route + destination. O
 * shape e fixo (RouteCoordinate, RouteStep, primitivos) — sem objetos
 * complexos que JSON nao consegue. Defense: parser le validando e
 * descartando se mal-formado.
 */

export interface ActiveRouteSnapshot {
  route: Route;
  destination: GeoPosition | null;
  savedAt: number;
  /** F36.1.1 — True se a sessao anterior estava com navegacao em curso
   *  (isNavigating=true) quando salvou. O hydrate usa isso pra decidir se
   *  retoma direto em modo navegacao ou so deixa a rota visivel. */
  wasNavigating: boolean;
  /** Epoch ms do `startNavigation()` original. Permite ao TripTimerBadge
   *  continuar mostrando tempo total da viagem em vez de zerar. */
  tripStartedAt: number | null;
}

export interface SaveActiveRouteInput {
  route: Route;
  destination: GeoPosition | null;
  wasNavigating: boolean;
  tripStartedAt: number | null;
}

export interface ActiveRouteRepository {
  /** Grava a rota ativa (+ destino + flags de navegacao) sobrescrevendo
   *  qualquer versao anterior. Idempotente. */
  save: (input: SaveActiveRouteInput, now?: number) => Promise<void>;
  /** Le a rota ativa do disco. null se nao houver, ou se o payload estiver
   *  corrompido (defensive parse). */
  load: () => Promise<ActiveRouteSnapshot | null>;
  /** Apaga o cache. Chamado quando a navegacao para. */
  clear: () => Promise<void>;
}

interface ActiveRouteRow {
  id: number;
  payload: string;
  destination: string | null;
  saved_at: number;
  was_navigating?: number;
  trip_started_at?: number | null;
}

function isValidCoordinate(value: unknown): value is { latitude: number; longitude: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { latitude?: unknown; longitude?: unknown };
  return typeof v.latitude === 'number' && typeof v.longitude === 'number';
}

function parseRoute(json: string): Route | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<Route>;
  if (!Array.isArray(r.coordinates)) return null;
  if (r.coordinates.length === 0) return null;
  if (!r.coordinates.every(isValidCoordinate)) return null;
  if (typeof r.distanceMeters !== 'number') return null;
  if (typeof r.durationSeconds !== 'number') return null;
  if (!Array.isArray(r.steps)) return null;
  const route: Route = {
    coordinates: r.coordinates as Route['coordinates'],
    distanceMeters: r.distanceMeters,
    durationSeconds: r.durationSeconds,
    steps: r.steps as Route['steps'],
    fetchedAt: typeof r.fetchedAt === 'number' ? r.fetchedAt : Date.now(),
    cacheHit: true,
  };
  if (typeof r.sinuosityScore === 'number') {
    route.sinuosityScore = r.sinuosityScore;
  }
  return route;
}

function parseDestination(json: string | null): GeoPosition | null {
  if (json === null || json.length === 0) return null;
  try {
    const raw = JSON.parse(json) as Partial<GeoPosition>;
    if (
      typeof raw.latitude === 'number' &&
      typeof raw.longitude === 'number' &&
      typeof raw.timestamp === 'number'
    ) {
      return raw as GeoPosition;
    }
  } catch {
    // ignore
  }
  return null;
}

export function createSqliteActiveRouteRepository(
  db: SQLite.SQLiteDatabase,
): ActiveRouteRepository {
  return {
    save: async (input, now = Date.now()) => {
      const payload = JSON.stringify(input.route);
      const dest =
        input.destination !== null ? JSON.stringify(input.destination) : null;
      await db.runAsync(
        `INSERT INTO active_route_cache
           (id, payload, destination, saved_at, was_navigating, trip_started_at)
           VALUES (1, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             payload = excluded.payload,
             destination = excluded.destination,
             saved_at = excluded.saved_at,
             was_navigating = excluded.was_navigating,
             trip_started_at = excluded.trip_started_at;`,
        [
          payload,
          dest,
          now,
          input.wasNavigating ? 1 : 0,
          input.tripStartedAt,
        ],
      );
    },
    load: async () => {
      const row = await db.getFirstAsync<ActiveRouteRow>(
        'SELECT * FROM active_route_cache WHERE id = 1 LIMIT 1;',
      );
      if (!row) return null;
      const route = parseRoute(row.payload);
      if (route === null) return null;
      return {
        route,
        destination: parseDestination(row.destination),
        savedAt: row.saved_at,
        wasNavigating: row.was_navigating === 1,
        tripStartedAt:
          typeof row.trip_started_at === 'number' ? row.trip_started_at : null,
      };
    },
    clear: async () => {
      await db.runAsync('DELETE FROM active_route_cache;');
    },
  };
}

let _singleton: ActiveRouteRepository | null = null;

export async function getActiveRouteRepo(): Promise<ActiveRouteRepository> {
  if (_singleton) return _singleton;
  const db = await initDatabase();
  _singleton = createSqliteActiveRouteRepository(db);
  return _singleton;
}

export function _resetActiveRouteRepoForTests(): void {
  _singleton = null;
}
