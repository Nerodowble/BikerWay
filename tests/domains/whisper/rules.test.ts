import {
  findDuplicate,
  isExpired,
  isWithinGeofence,
  mergeReport,
  pruneExpired,
} from '@/domains/whisper/rules';
import {
  WHISPER_DEDUP_WINDOW_MS,
  WHISPER_TTL_MS,
  type WhisperReport,
} from '@/domains/whisper/types';

function makeReport(
  partial: Partial<WhisperReport> & {
    id: string;
    createdAt: number;
  },
): WhisperReport {
  return {
    id: partial.id,
    rotaId: partial.rotaId ?? 'rota-x',
    kind: partial.kind ?? 'neblina',
    latitude: partial.latitude ?? -23.5,
    longitude: partial.longitude ?? -46.5,
    createdAt: partial.createdAt,
    reporterAlias: partial.reporterAlias ?? '@piloto',
    ...(partial.routeKm !== undefined ? { routeKm: partial.routeKm } : {}),
  };
}

describe('isExpired', () => {
  it('false quando recente', () => {
    expect(isExpired({ createdAt: 1_000 }, 2_000)).toBe(false);
  });
  it('true depois do TTL', () => {
    expect(isExpired({ createdAt: 1_000 }, 1_000 + WHISPER_TTL_MS + 1)).toBe(
      true,
    );
  });
});

describe('findDuplicate', () => {
  const existing = [
    makeReport({
      id: 'a',
      kind: 'neblina',
      latitude: -23.5,
      longitude: -46.5,
      createdAt: 1_000,
    }),
  ];

  it('detecta duplicata mesmo kind + dentro do raio + janela', () => {
    const dup = findDuplicate(existing, {
      kind: 'neblina',
      latitude: -23.5005, // ~55m
      longitude: -46.5,
      createdAt: 1_000 + 5_000,
    });
    expect(dup?.id).toBe('a');
  });
  it('NAO duplica kind diferente', () => {
    const dup = findDuplicate(existing, {
      kind: 'chuva',
      latitude: -23.5,
      longitude: -46.5,
      createdAt: 1_000,
    });
    expect(dup).toBeNull();
  });
  it('NAO duplica longe do raio', () => {
    const dup = findDuplicate(existing, {
      kind: 'neblina',
      latitude: -22.5, // ~110km
      longitude: -46.5,
      createdAt: 1_000,
    });
    expect(dup).toBeNull();
  });
  it('NAO duplica fora da janela temporal', () => {
    const dup = findDuplicate(existing, {
      kind: 'neblina',
      latitude: -23.5,
      longitude: -46.5,
      createdAt: 1_000 + WHISPER_DEDUP_WINDOW_MS + 1,
    });
    expect(dup).toBeNull();
  });
});

describe('mergeReport', () => {
  it('prepende quando novo', () => {
    const r1 = makeReport({ id: 'r1', createdAt: 1_000 });
    const r2 = makeReport({
      id: 'r2',
      kind: 'chuva',
      createdAt: 2_000,
    });
    const merged = mergeReport([r1], r2, 3_000);
    expect(merged.map((r) => r.id)).toEqual(['r2', 'r1']);
  });
  it('ignora id ja conhecido', () => {
    const r1 = makeReport({ id: 'r1', createdAt: 1_000 });
    const merged = mergeReport([r1], r1, 2_000);
    expect(merged).toHaveLength(1);
  });
  it('substitui duplicata por versao mais recente', () => {
    const r1 = makeReport({ id: 'r1', createdAt: 1_000 });
    const r2 = makeReport({
      id: 'r2',
      latitude: -23.5005,
      createdAt: 2_000,
    });
    const merged = mergeReport([r1], r2, 3_000);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('r2');
  });
  it('filtra expirados ao mesclar', () => {
    const old = makeReport({ id: 'old', createdAt: 1_000 });
    const newish = makeReport({
      id: 'newish',
      kind: 'chuva',
      createdAt: 1_000 + WHISPER_TTL_MS + 1_000,
    });
    const now = 1_000 + WHISPER_TTL_MS + 2_000;
    const merged = mergeReport([old], newish, now);
    expect(merged.map((r) => r.id)).toEqual(['newish']);
  });
  it('ordem descendente por createdAt', () => {
    const r1 = makeReport({ id: 'r1', createdAt: 1_000 });
    const r2 = makeReport({ id: 'r2', kind: 'chuva', createdAt: 3_000 });
    const r3 = makeReport({
      id: 'r3',
      kind: 'posto_fechado',
      createdAt: 2_000,
    });
    let merged = mergeReport([r1], r2, 5_000);
    merged = mergeReport(merged, r3, 5_000);
    expect(merged.map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
  });
});

describe('isWithinGeofence', () => {
  const polyline = [
    { latitude: -23.5, longitude: -46.5 },
    { latitude: -23.4, longitude: -46.4 },
  ];

  it('true quando ha sample recente proximo a um vertice', () => {
    const history = [
      {
        latitude: -23.5,
        longitude: -46.5,
        timestamp: 1_000,
      },
    ];
    expect(
      isWithinGeofence(history, polyline, { now: 2_000 }),
    ).toBe(true);
  });
  it('false quando samples sao todos antigos', () => {
    const history = [
      {
        latitude: -23.5,
        longitude: -46.5,
        timestamp: 1_000,
      },
    ];
    // 1h depois — janela default e 30 min
    expect(
      isWithinGeofence(history, polyline, { now: 1_000 + 60 * 60 * 1000 }),
    ).toBe(false);
  });
  it('false quando samples sao longe', () => {
    const history = [
      { latitude: -10, longitude: -40, timestamp: 1_000 },
    ];
    expect(isWithinGeofence(history, polyline, { now: 2_000 })).toBe(false);
  });
});

describe('pruneExpired', () => {
  it('mantem so reports nao expirados', () => {
    const r1 = makeReport({ id: 'r1', createdAt: 1_000 });
    const r2 = makeReport({
      id: 'r2',
      createdAt: 1_000 + WHISPER_TTL_MS + 1_000,
    });
    const now = 1_000 + WHISPER_TTL_MS + 5_000;
    const result = pruneExpired([r1, r2], now);
    expect(result.map((r) => r.id)).toEqual(['r2']);
  });
});
