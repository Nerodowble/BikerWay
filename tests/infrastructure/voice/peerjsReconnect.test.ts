import { buildJitsiHtml } from '../../../src/infrastructure/voice/jitsiHtml';

/**
 * The reconnect logic lives inside the WebView page script as a string —
 * we cannot run it in Jest, but we CAN assert that the HTML/JS surface
 * contains the silent-reconnect contract callers depend on:
 *
 *   1. pingInterval is set to 5000ms on the Peer constructor.
 *   2. The page wires a 'disconnected' listener that schedules a reconnect.
 *   3. Transient errors (network/disconnected/server-error/socket-error/
 *      socket-closed) do NOT propagate as bridgeError messages — they are
 *      filtered into the silent-reconnect loop instead.
 *   4. Backoff steps are 2s, 4s, 8s, 16s, 30s (capped).
 *   5. A 'voice-status' postMessage type exists with 'reconnecting' and
 *      'connected' payload values.
 *   6. bwSendPosition pauses while peer.disconnected is true.
 *
 * If any of these regresses, the rider would see banners during a network
 * drop or the pins would freeze without recovery.
 */
describe('buildJitsiHtml — silent reconnect contract', () => {
  const html = buildJitsiHtml({ roomName: 'bw-test', displayName: 'Piloto' });

  it('configures PeerJS with pingInterval: 5000', () => {
    expect(html).toMatch(/pingInterval:\s*5000/);
  });

  it('attaches a peer.on("disconnected") listener that schedules a reconnect', () => {
    expect(html).toMatch(/p\.on\(['"]disconnected['"]/);
    expect(html).toContain('scheduleReconnect()');
  });

  it('declares the exponential backoff sequence 2/4/8/16/30 seconds', () => {
    // Strip whitespace inside the array literal so the assertion is robust
    // against formatter changes; we still care that the values stay aligned
    // with the spec.
    const normalised = html.replace(/\s+/g, '');
    expect(normalised).toContain('BACKOFF_STEPS_MS=[2000,4000,8000,16000,30000]');
  });

  it('declares a tryReconnect function that calls peer.reconnect()', () => {
    expect(html).toContain('function tryReconnect');
    expect(html).toContain('peer.reconnect()');
  });

  it('filters transient transport errors out of the bridgeError path', () => {
    // The page must intercept these specific error.type values and route
    // them to scheduleReconnect instead of self._onError. If the regex
    // below fails the transient errors would surface as red banners.
    expect(html).toContain("t === 'network'");
    expect(html).toContain("t === 'disconnected'");
    expect(html).toContain("t === 'server-error'");
    expect(html).toContain("t === 'socket-error'");
    expect(html).toContain("t === 'socket-closed'");
  });

  it('posts voice-status events with reconnecting / connected payloads', () => {
    // We post via the generic `post('voice-status', { status })` helper —
    // assert both the type string and the two payload values appear in
    // the page so the RN bridge can route them.
    expect(html).toContain("'voice-status'");
    expect(html).toContain("postStatus('reconnecting')");
    expect(html).toContain("postStatus('connected')");
  });

  it('bwSendPosition short-circuits while the peer is disconnected', () => {
    // The guard must check both `peer.disconnected` AND `peer.destroyed`
    // so a teardown does not leak broadcasts and a transient drop does
    // not waste CPU re-queueing packets. The function body sits inside a
    // multi-line comment block so we accept a wide match window between
    // the function name and the guard line.
    expect(html).toMatch(
      /bwSendPosition\s*=\s*function[\s\S]{0,800}peer\.disconnected[\s\S]{0,200}peer\.destroyed/,
    );
  });

  it('clears the reconnect timer on transport.dispose so hangup truly stops the loop', () => {
    // Allow a longer window between `dispose: function` and the helper call
    // — the comment block inside dispose explains WHY and pushes the call
    // a few lines down.
    expect(html).toMatch(/dispose:\s*function[\s\S]{0,800}clearReconnectTimer\(\)/);
  });
});
