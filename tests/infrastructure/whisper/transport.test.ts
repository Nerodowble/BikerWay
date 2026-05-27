import { createLoopbackWhisperTransport } from '@/infrastructure/whisper/transport';
import type { WhisperReport } from '@/domains/whisper/types';

function makeReport(
  partial: Partial<WhisperReport> & { id: string; createdAt: number },
): WhisperReport {
  return {
    id: partial.id,
    rotaId: partial.rotaId ?? 'r1',
    kind: partial.kind ?? 'neblina',
    latitude: partial.latitude ?? -23.5,
    longitude: partial.longitude ?? -46.5,
    createdAt: partial.createdAt,
    reporterAlias: '@piloto',
  };
}

function flushTimers(): Promise<void> {
  return new Promise((r) => setTimeout(r, 5));
}

describe('LoopbackWhisperTransport', () => {
  it('broadcasta report pra todos os listeners', async () => {
    const transport = createLoopbackWhisperTransport();
    const received1: WhisperReport[] = [];
    const received2: WhisperReport[] = [];
    transport.subscribe((r) => received1.push(r));
    transport.subscribe((r) => received2.push(r));
    await transport.join('r1');
    await transport.publish(
      makeReport({ id: 'a', createdAt: Date.now() }),
    );
    await flushTimers();
    expect(received1.map((r) => r.id)).toEqual(['a']);
    expect(received2.map((r) => r.id)).toEqual(['a']);
  });

  it('JSON round-trip serializa/deserializa cleanly', async () => {
    const transport = createLoopbackWhisperTransport();
    const received: WhisperReport[] = [];
    transport.subscribe((r) => received.push(r));
    const original = makeReport({
      id: 'a',
      kind: 'chuva',
      latitude: -22.5,
      longitude: -45.5,
      createdAt: 12345,
    });
    await transport.publish(original);
    await flushTimers();
    // O resultado e identico em campos mas e uma nova instancia (copy
    // via JSON.parse) — guarda contra mutacoes do listener.
    expect(received[0]).not.toBe(original);
    expect(received[0]).toEqual(original);
  });

  it('unsubscribe para de entregar pro listener', async () => {
    const transport = createLoopbackWhisperTransport();
    const received: WhisperReport[] = [];
    const unsub = transport.subscribe((r) => received.push(r));
    unsub();
    await transport.join('r1');
    await transport.publish(makeReport({ id: 'a', createdAt: Date.now() }));
    await flushTimers();
    expect(received).toHaveLength(0);
  });

  it('cache TTL: novo subscriber depois do publish recebe cache via join', async () => {
    const now = Date.now();
    const transport = createLoopbackWhisperTransport({ now: () => now });
    // Publish primeiro, sem listeners
    await transport.publish(
      makeReport({ id: 'a', rotaId: 'r1', createdAt: now }),
    );
    await flushTimers();
    // Agora subscribe + join
    const received: WhisperReport[] = [];
    transport.subscribe((r) => received.push(r));
    await transport.join('r1');
    await flushTimers();
    expect(received.map((r) => r.id)).toEqual(['a']);
  });

  it('cache descarta reports expirados ao re-emitir no join', async () => {
    const now = 100_000_000;
    const transport = createLoopbackWhisperTransport({ now: () => now });
    // Report ja expirado (>6h atras)
    await transport.publish(
      makeReport({
        id: 'old',
        rotaId: 'r1',
        createdAt: now - 7 * 60 * 60 * 1000,
      }),
    );
    await flushTimers();
    const received: WhisperReport[] = [];
    transport.subscribe((r) => received.push(r));
    await transport.join('r1');
    await flushTimers();
    expect(received).toHaveLength(0);
  });
});
