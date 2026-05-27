import { deriveRouteTheme } from '../catalog/theme';
import type { CatalogRoute } from '../catalog/types';
import type { TripHistoryEntry } from '../rideHistory/types';
import type { Badge, BadgeId } from './types';

/**
 * F35.3 — Engine de badges puro. Recebe `trips` + `catalog` + `now` e retorna
 * a lista de badges com seu status atual (unlocked / progress).
 *
 * Decisao de design: regras como funcoes pequenas que retornam
 * `{ unlocked: boolean; progress: number; unlockedAt?: number }`. Isso
 * facilita adicionar novos badges sem mexer no resto + permite testes
 * unitarios precisos por badge.
 */

type CompletedTrip = TripHistoryEntry & { completedAt: number };

interface BadgeRule {
  id: BadgeId;
  icon: string;
  title: string;
  description: string;
  evaluate: (input: {
    trips: ReadonlyArray<CompletedTrip>;
    catalog: ReadonlyArray<CatalogRoute>;
    catalogById: ReadonlyMap<string, CatalogRoute>;
    now: number;
  }) => { unlocked: boolean; progress: number; unlockedAt?: number };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SE_STATES = new Set(['SP', 'MG', 'RJ', 'ES']);
const S_STATES = new Set(['PR', 'SC', 'RS']);

function startOfHour(epoch: number): number {
  const d = new Date(epoch);
  return d.getHours();
}

function getRouteState(route: CatalogRoute): string | null {
  // `estado_pais` no JSON do catalogo segue padrao "SP" ou "SP/RJ" ou
  // "São Paulo / Brasil". Pegamos os primeiros 2 chars que casam com UF.
  // Imprecisa mas suficiente — o catalogo curado usa siglas em quase
  // todos os casos validados ate aqui.
  const m = /\b([A-Z]{2})\b/.exec(route.estado_pais);
  return m ? m[1] ?? null : null;
}

function getAllStatesForRoute(route: CatalogRoute): string[] {
  const matches = route.estado_pais.match(/\b[A-Z]{2}\b/g);
  return matches ?? [];
}

const RULES: BadgeRule[] = [
  {
    id: 'first-route',
    icon: '🏁',
    title: 'Primeira viagem',
    description: 'Completou sua primeira rota do catálogo.',
    evaluate: ({ trips }) => {
      if (trips.length === 0) return { unlocked: false, progress: 0 };
      const first = trips.reduce((min, t) =>
        t.completedAt < min.completedAt ? t : min,
      );
      return {
        unlocked: true,
        progress: 1,
        unlockedAt: first.completedAt,
      };
    },
  },
  {
    id: 'south-east-conqueror',
    icon: '🏔️',
    title: 'Conquistou o Sudeste',
    description: 'Completou pelo menos uma rota em SP, MG, RJ e ES.',
    evaluate: ({ trips, catalogById }) => {
      const seen = new Set<string>();
      let latestUnlock = 0;
      for (const t of trips) {
        const route = catalogById.get(t.rotaId);
        if (!route) continue;
        for (const uf of getAllStatesForRoute(route)) {
          if (SE_STATES.has(uf)) {
            if (!seen.has(uf)) latestUnlock = Math.max(latestUnlock, t.completedAt);
            seen.add(uf);
          }
        }
      }
      const progress = Math.min(seen.size / SE_STATES.size, 1);
      const unlocked = seen.size >= SE_STATES.size;
      const base = { unlocked, progress };
      return unlocked ? { ...base, unlockedAt: latestUnlock } : base;
    },
  },
  {
    id: 'south-conqueror',
    icon: '🥾',
    title: 'Conquistou o Sul',
    description: 'Completou pelo menos uma rota em PR, SC e RS.',
    evaluate: ({ trips, catalogById }) => {
      const seen = new Set<string>();
      let latestUnlock = 0;
      for (const t of trips) {
        const route = catalogById.get(t.rotaId);
        if (!route) continue;
        for (const uf of getAllStatesForRoute(route)) {
          if (S_STATES.has(uf)) {
            if (!seen.has(uf)) latestUnlock = Math.max(latestUnlock, t.completedAt);
            seen.add(uf);
          }
        }
      }
      const progress = Math.min(seen.size / S_STATES.size, 1);
      const unlocked = seen.size >= S_STATES.size;
      const base = { unlocked, progress };
      return unlocked ? { ...base, unlockedAt: latestUnlock } : base;
    },
  },
  {
    id: 'coast-master',
    icon: '🌊',
    title: 'Mestre do Litoral',
    description: 'Completou todas as rotas marcadas como tema LITORAL.',
    evaluate: ({ trips, catalog, catalogById }) => {
      const coastalRoutes = catalog.filter(
        (r) => deriveRouteTheme(r) === 'litoral',
      );
      if (coastalRoutes.length === 0) return { unlocked: false, progress: 0 };
      const completedCoastal = new Set<string>();
      let latestUnlock = 0;
      for (const t of trips) {
        const route = catalogById.get(t.rotaId);
        if (!route) continue;
        if (deriveRouteTheme(route) === 'litoral') {
          completedCoastal.add(t.rotaId);
          latestUnlock = Math.max(latestUnlock, t.completedAt);
        }
      }
      const total = coastalRoutes.length;
      const progress = Math.min(completedCoastal.size / total, 1);
      const unlocked = completedCoastal.size >= total;
      const base = { unlocked, progress };
      return unlocked ? { ...base, unlockedAt: latestUnlock } : base;
    },
  },
  {
    id: 'mountain-five-of-year',
    icon: '🏞️',
    title: '5 serras no ano',
    description:
      'Completou 5 rotas de curvas elevadas no ano corrente.',
    evaluate: ({ trips, catalogById, now }) => {
      const year = new Date(now).getFullYear();
      let count = 0;
      let latestUnlock = 0;
      for (const t of trips) {
        const route = catalogById.get(t.rotaId);
        if (!route) continue;
        if (route.caracteristicas.nivel_curvas !== 'alto') continue;
        if (new Date(t.completedAt).getFullYear() !== year) continue;
        count += 1;
        if (count === 5) latestUnlock = t.completedAt;
      }
      const progress = Math.min(count / 5, 1);
      const unlocked = count >= 5;
      const base = { unlocked, progress };
      return unlocked ? { ...base, unlockedAt: latestUnlock } : base;
    },
  },
  {
    id: 'early-bird',
    icon: '🌅',
    title: 'Madrugador',
    description: 'Iniciou ≥ 3 viagens antes das 6h da manhã.',
    evaluate: ({ trips }) => {
      const earlies = trips.filter(
        (t) => startOfHour(t.startedAt) < 6,
      );
      const count = earlies.length;
      const progress = Math.min(count / 3, 1);
      if (count < 3) return { unlocked: false, progress };
      // O 3o trip "madrugador" e o que destrava — pega ordenando.
      const sorted = [...earlies].sort(
        (a, b) => a.completedAt - b.completedAt,
      );
      return {
        unlocked: true,
        progress,
        unlockedAt: sorted[2]?.completedAt ?? 0,
      };
    },
  },
  {
    id: 'marathoner',
    icon: '🛣️',
    title: 'Maratonista',
    description: 'Completou uma viagem ≥ 300 km registrados.',
    evaluate: ({ trips }) => {
      let unlockedAt = 0;
      for (const t of trips) {
        if ((t.distanceKm ?? 0) >= 300) {
          if (unlockedAt === 0 || t.completedAt < unlockedAt) {
            unlockedAt = t.completedAt;
          }
        }
      }
      const unlocked = unlockedAt > 0;
      const base = { unlocked, progress: unlocked ? 1 : 0 };
      return unlocked ? { ...base, unlockedAt } : base;
    },
  },
  {
    id: 'veteran',
    icon: '🎖️',
    title: 'Veterano',
    description: 'Completou 20 rotas do catálogo.',
    evaluate: ({ trips }) => {
      const count = trips.length;
      const progress = Math.min(count / 20, 1);
      if (count < 20) return { unlocked: false, progress };
      const sorted = [...trips].sort(
        (a, b) => a.completedAt - b.completedAt,
      );
      return {
        unlocked: true,
        progress,
        unlockedAt: sorted[19]?.completedAt ?? 0,
      };
    },
  },
  {
    id: 'anniversary',
    icon: '🎉',
    title: 'Aniversário de rota',
    description:
      'Completou uma rota e exatamente um ano depois a fez de novo.',
    evaluate: ({ trips }) => {
      // Agrupa trips por rota_id. Para cada rota com >=2 conclusoes,
      // checa se algum par tem ~1 ano de diferenca (janela +-2 dias).
      const byRoute = new Map<string, number[]>();
      for (const t of trips) {
        const list = byRoute.get(t.rotaId) ?? [];
        list.push(t.completedAt);
        byRoute.set(t.rotaId, list);
      }
      let unlockedAt = 0;
      for (const [, times] of byRoute) {
        if (times.length < 2) continue;
        times.sort((a, b) => a - b);
        for (let i = 0; i < times.length; i += 1) {
          for (let j = i + 1; j < times.length; j += 1) {
            const tA = times[i];
            const tB = times[j];
            if (tA === undefined || tB === undefined) continue;
            const diff = tB - tA;
            const year = 365 * MS_PER_DAY;
            if (Math.abs(diff - year) <= 2 * MS_PER_DAY) {
              if (unlockedAt === 0 || tB < unlockedAt) unlockedAt = tB;
            }
          }
        }
      }
      const unlocked = unlockedAt > 0;
      const base = { unlocked, progress: unlocked ? 1 : 0 };
      return unlocked ? { ...base, unlockedAt } : base;
    },
  },
  {
    id: 'two-states-day',
    icon: '🚩',
    title: 'Dois estados no mesmo dia',
    description:
      'Completou rotas em pelo menos dois estados diferentes no mesmo dia.',
    evaluate: ({ trips, catalogById }) => {
      // Agrupa trips por dia (YYYY-MM-DD em local time). Pra cada dia,
      // coleta o set de estados.
      const byDay = new Map<string, Set<string>>();
      const dayUnlockTimestamp = new Map<string, number>();
      for (const t of trips) {
        const route = catalogById.get(t.rotaId);
        if (!route) continue;
        const uf = getRouteState(route);
        if (!uf) continue;
        const d = new Date(t.completedAt);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const set = byDay.get(key) ?? new Set<string>();
        set.add(uf);
        byDay.set(key, set);
        if (set.size >= 2 && !dayUnlockTimestamp.has(key)) {
          dayUnlockTimestamp.set(key, t.completedAt);
        }
      }
      let earliest = 0;
      for (const ts of dayUnlockTimestamp.values()) {
        if (earliest === 0 || ts < earliest) earliest = ts;
      }
      const unlocked = earliest > 0;
      const base = { unlocked, progress: unlocked ? 1 : 0 };
      return unlocked ? { ...base, unlockedAt: earliest } : base;
    },
  },
];

/**
 * Computa todos os badges com seu status atual. Mantem a ordem do array
 * `RULES` pra que a UI tenha layout estavel — UNLOCKED no topo seria papel
 * da UI (sort).
 */
export function computeBadges(
  trips: ReadonlyArray<TripHistoryEntry>,
  catalog: ReadonlyArray<CatalogRoute>,
  now: number = Date.now(),
): Badge[] {
  const completed: CompletedTrip[] = [];
  for (const t of trips) {
    if (typeof t.completedAt === 'number' && t.completedAt > 0) {
      completed.push({ ...t, completedAt: t.completedAt });
    }
  }
  const catalogById = new Map(catalog.map((r) => [r.rota_id, r]));

  return RULES.map((rule) => {
    const result = rule.evaluate({
      trips: completed,
      catalog,
      catalogById,
      now,
    });
    const badge: Badge = {
      id: rule.id,
      icon: rule.icon,
      title: rule.title,
      description: rule.description,
      progress: result.progress,
    };
    if (result.unlockedAt !== undefined) {
      badge.unlockedAt = result.unlockedAt;
    }
    return badge;
  });
}
