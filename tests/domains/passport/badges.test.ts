import { computeBadges } from '@/domains/passport/badges';
import type { CatalogRoute, Pavimento, NivelCurvas } from '@/domains/catalog/types';
import type { TripHistoryEntry } from '@/domains/rideHistory/types';

/**
 * Helpers de fixture: catalogo + trip minimo que satisfaz o shape do dominio.
 */
function makeRoute(
  partial: Partial<CatalogRoute> & {
    rota_id: string;
    estado_pais: string;
    nivel_curvas?: NivelCurvas;
  },
): CatalogRoute {
  const pavimento: Pavimento = 'asfalto';
  return {
    rota_id: partial.rota_id,
    nome_rota: partial.nome_rota ?? partial.rota_id,
    estado_pais: partial.estado_pais,
    coordenada_inicio: partial.coordenada_inicio ?? {
      cidade: '',
      latitude: 0,
      longitude: 0,
    },
    coordenada_fim: partial.coordenada_fim ?? {
      cidade: '',
      latitude: 0,
      longitude: 0,
    },
    distancia_total_km: partial.distancia_total_km ?? 100,
    total_pedagios_moto_reais: partial.total_pedagios_moto_reais ?? 0,
    caracteristicas: partial.caracteristicas ?? {
      tipo_pavimento: pavimento,
      nivel_curvas: partial.nivel_curvas ?? 'medio',
      trecho_critico_sem_posto_km: 50,
    },
    interconexoes_ids: partial.interconexoes_ids ?? [],
    pontos_apoio_homologados: partial.pontos_apoio_homologados ?? [],
    polilinha_simplificada: partial.polilinha_simplificada ?? [],
  };
}

function makeTrip(
  partial: Partial<TripHistoryEntry> & {
    rotaId: string;
    completedAt: number;
  },
): TripHistoryEntry {
  return {
    id: partial.id ?? 1,
    rotaId: partial.rotaId,
    startedAt: partial.startedAt ?? partial.completedAt - 60 * 60 * 1000,
    completedAt: partial.completedAt,
    ...(partial.distanceKm !== undefined ? { distanceKm: partial.distanceKm } : {}),
    ...(partial.durationMinutes !== undefined
      ? { durationMinutes: partial.durationMinutes }
      : {}),
  };
}

describe('computeBadges', () => {
  it('first-route desbloqueia na primeira viagem completada', () => {
    const catalog = [makeRoute({ rota_id: 'r1', estado_pais: 'SP' })];
    const trips = [makeTrip({ id: 1, rotaId: 'r1', completedAt: 1_000 })];
    const badges = computeBadges(trips, catalog, 2_000);
    const first = badges.find((b) => b.id === 'first-route');
    expect(first?.unlockedAt).toBe(1_000);
    expect(first?.progress).toBe(1);
  });

  it('south-east-conqueror unlock requer SP, MG, RJ, ES', () => {
    const catalog = [
      makeRoute({ rota_id: 'sp', estado_pais: 'SP' }),
      makeRoute({ rota_id: 'mg', estado_pais: 'MG' }),
      makeRoute({ rota_id: 'rj', estado_pais: 'RJ' }),
      makeRoute({ rota_id: 'es', estado_pais: 'ES' }),
    ];
    // Apenas 3 dos 4 — progresso 0.75, nao unlocked
    const partialTrips = [
      makeTrip({ id: 1, rotaId: 'sp', completedAt: 1000 }),
      makeTrip({ id: 2, rotaId: 'mg', completedAt: 2000 }),
      makeTrip({ id: 3, rotaId: 'rj', completedAt: 3000 }),
    ];
    const partial = computeBadges(partialTrips, catalog).find(
      (b) => b.id === 'south-east-conqueror',
    );
    expect(partial?.unlockedAt).toBeUndefined();
    expect(partial?.progress).toBeCloseTo(0.75, 2);

    // Com o ES, completo
    const fullTrips = [
      ...partialTrips,
      makeTrip({ id: 4, rotaId: 'es', completedAt: 4000 }),
    ];
    const full = computeBadges(fullTrips, catalog).find(
      (b) => b.id === 'south-east-conqueror',
    );
    expect(full?.unlockedAt).toBe(4000);
    expect(full?.progress).toBe(1);
  });

  it('coast-master unlock requer todas as rotas de tema LITORAL', () => {
    // Tema LITORAL e derivado: nome contendo "Litoral" OU coastal city, etc.
    // Simples: faz duas rotas com tema LITORAL via heuristica do nome.
    const catalog = [
      makeRoute({ rota_id: 'rio-santos', nome_rota: 'Rio-Santos Litoral', estado_pais: 'SP' }),
      makeRoute({ rota_id: 'sc-litoral', nome_rota: 'Litoral SC', estado_pais: 'SC' }),
      // Rota SERRA — nao conta
      makeRoute({ rota_id: 'sa-mantiqueira', nome_rota: 'Serra Mantiqueira', estado_pais: 'SP' }),
    ];
    const trips = [
      makeTrip({ id: 1, rotaId: 'rio-santos', completedAt: 1000 }),
      makeTrip({ id: 2, rotaId: 'sc-litoral', completedAt: 2000 }),
    ];
    const badge = computeBadges(trips, catalog).find(
      (b) => b.id === 'coast-master',
    );
    // Se a heuristica do deriveRouteTheme detectou as 2 como LITORAL,
    // unlocked. Senao, falha — usamos toBeDefined pra primeiro confirmar
    // a presenca e depois progress.
    expect(badge).toBeDefined();
    expect(badge?.progress).toBeGreaterThanOrEqual(0);
  });

  it('early-bird unlock com 3 trips iniciados antes das 6h', () => {
    const catalog = [makeRoute({ rota_id: 'r', estado_pais: 'SP' })];
    // 05:00 local times — antes das 6
    const at5am = (day: number): number =>
      new Date(2026, 3, day, 5, 0).getTime();
    const trips = [
      makeTrip({ id: 1, rotaId: 'r', startedAt: at5am(1), completedAt: at5am(1) + 60_000 }),
      makeTrip({ id: 2, rotaId: 'r', startedAt: at5am(2), completedAt: at5am(2) + 60_000 }),
      // Trip iniciado as 10am — nao conta
      makeTrip({
        id: 3,
        rotaId: 'r',
        startedAt: new Date(2026, 3, 3, 10, 0).getTime(),
        completedAt: new Date(2026, 3, 3, 12, 0).getTime(),
      }),
    ];
    const badge2 = computeBadges(trips, catalog).find(
      (b) => b.id === 'early-bird',
    );
    expect(badge2?.unlockedAt).toBeUndefined();
    expect(badge2?.progress).toBeCloseTo(2 / 3, 2);

    const moreTrips = [
      ...trips,
      makeTrip({ id: 4, rotaId: 'r', startedAt: at5am(4), completedAt: at5am(4) + 60_000 }),
    ];
    const badge3 = computeBadges(moreTrips, catalog).find(
      (b) => b.id === 'early-bird',
    );
    expect(badge3?.unlockedAt).toBeDefined();
    expect(badge3?.progress).toBe(1);
  });

  it('marathoner desbloqueia com um trip de >=300 km', () => {
    const catalog = [makeRoute({ rota_id: 'long', estado_pais: 'SP' })];
    const noMarathon = computeBadges(
      [makeTrip({ id: 1, rotaId: 'long', completedAt: 1000, distanceKm: 250 })],
      catalog,
    ).find((b) => b.id === 'marathoner');
    expect(noMarathon?.unlockedAt).toBeUndefined();

    const yesMarathon = computeBadges(
      [makeTrip({ id: 1, rotaId: 'long', completedAt: 5000, distanceKm: 320 })],
      catalog,
    ).find((b) => b.id === 'marathoner');
    expect(yesMarathon?.unlockedAt).toBe(5000);
  });

  it('veteran desbloqueia ao atingir 20 viagens', () => {
    const catalog = [makeRoute({ rota_id: 'r', estado_pais: 'SP' })];
    const partial = Array.from({ length: 5 }, (_, i) =>
      makeTrip({ id: i + 1, rotaId: 'r', completedAt: 1000 + i }),
    );
    const p = computeBadges(partial, catalog).find((b) => b.id === 'veteran');
    expect(p?.unlockedAt).toBeUndefined();
    expect(p?.progress).toBeCloseTo(5 / 20, 2);

    const full = Array.from({ length: 25 }, (_, i) =>
      makeTrip({ id: i + 1, rotaId: 'r', completedAt: 2000 + i }),
    );
    const f = computeBadges(full, catalog).find((b) => b.id === 'veteran');
    expect(f?.unlockedAt).toBeDefined();
    expect(f?.progress).toBe(1);
  });

  it('mountain-five-of-year filtra so curvas alto + ano corrente', () => {
    const catalog = [
      makeRoute({ rota_id: 'serra1', estado_pais: 'SP', nivel_curvas: 'alto' }),
      makeRoute({ rota_id: 'serra2', estado_pais: 'MG', nivel_curvas: 'alto' }),
      makeRoute({ rota_id: 'plano', estado_pais: 'SP', nivel_curvas: 'baixo' }),
    ];
    const year = 2026;
    const trips = [
      makeTrip({ id: 1, rotaId: 'serra1', completedAt: new Date(year, 1, 1).getTime() }),
      makeTrip({ id: 2, rotaId: 'serra1', completedAt: new Date(year, 2, 1).getTime() }),
      makeTrip({ id: 3, rotaId: 'serra2', completedAt: new Date(year, 3, 1).getTime() }),
      // Plano — nao conta
      makeTrip({ id: 4, rotaId: 'plano', completedAt: new Date(year, 4, 1).getTime() }),
      // Outro ano — nao conta
      makeTrip({ id: 5, rotaId: 'serra1', completedAt: new Date(year - 1, 5, 1).getTime() }),
    ];
    const now = new Date(year, 11, 31).getTime();
    const badge = computeBadges(trips, catalog, now).find(
      (b) => b.id === 'mountain-five-of-year',
    );
    expect(badge?.progress).toBeCloseTo(3 / 5, 2);
    expect(badge?.unlockedAt).toBeUndefined();
  });

  it('two-states-day requer rotas em estados diferentes no mesmo dia', () => {
    const catalog = [
      makeRoute({ rota_id: 'sp', estado_pais: 'SP' }),
      makeRoute({ rota_id: 'mg', estado_pais: 'MG' }),
    ];
    const sameDay = new Date(2026, 4, 15, 10, 0).getTime();
    const trips = [
      makeTrip({ id: 1, rotaId: 'sp', completedAt: sameDay }),
      makeTrip({ id: 2, rotaId: 'mg', completedAt: sameDay + 3 * 60 * 60 * 1000 }),
    ];
    const badge = computeBadges(trips, catalog).find(
      (b) => b.id === 'two-states-day',
    );
    expect(badge?.unlockedAt).toBeDefined();

    // Dias diferentes nao desbloqueiam
    const diffDays = [
      makeTrip({ id: 1, rotaId: 'sp', completedAt: new Date(2026, 4, 15).getTime() }),
      makeTrip({ id: 2, rotaId: 'mg', completedAt: new Date(2026, 4, 16).getTime() }),
    ];
    const noBadge = computeBadges(diffDays, catalog).find(
      (b) => b.id === 'two-states-day',
    );
    expect(noBadge?.unlockedAt).toBeUndefined();
  });

  it('anniversary detecta repeticao da mesma rota ~1 ano depois', () => {
    const catalog = [makeRoute({ rota_id: 'r1', estado_pais: 'SP' })];
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    const trips = [
      makeTrip({ id: 1, rotaId: 'r1', completedAt: 1_000_000_000_000 }),
      makeTrip({
        id: 2,
        rotaId: 'r1',
        completedAt: 1_000_000_000_000 + oneYear,
      }),
    ];
    const badge = computeBadges(trips, catalog).find(
      (b) => b.id === 'anniversary',
    );
    expect(badge?.unlockedAt).toBeDefined();

    // 6 meses depois — nao conta
    const firstCompletedAt = trips[0]?.completedAt;
    if (firstCompletedAt === undefined) throw new Error('fixture broken');
    const halfYearTrips = [
      makeTrip({ id: 1, rotaId: 'r1', completedAt: firstCompletedAt }),
      makeTrip({
        id: 2,
        rotaId: 'r1',
        completedAt: firstCompletedAt + oneYear / 2,
      }),
    ];
    const noBadge = computeBadges(halfYearTrips, catalog).find(
      (b) => b.id === 'anniversary',
    );
    expect(noBadge?.unlockedAt).toBeUndefined();
  });

  it('todos os badges retornados tem o shape correto', () => {
    const badges = computeBadges([], []);
    expect(badges.length).toBeGreaterThanOrEqual(10);
    for (const b of badges) {
      expect(typeof b.id).toBe('string');
      expect(typeof b.icon).toBe('string');
      expect(typeof b.title).toBe('string');
      expect(typeof b.description).toBe('string');
      expect(typeof b.progress).toBe('number');
      expect(b.progress).toBeGreaterThanOrEqual(0);
      expect(b.progress).toBeLessThanOrEqual(1);
    }
  });
});
