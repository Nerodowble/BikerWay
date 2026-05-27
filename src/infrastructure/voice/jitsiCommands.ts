export type JitsiCommand =
  | { kind: 'toggleAudio' }
  | { kind: 'setAudioMuted'; muted: boolean }
  | { kind: 'setIncomingMuted'; muted: boolean }
  | { kind: 'hangup' }
  | { kind: 'setAudioOutput'; deviceId: string }
  | {
      kind: 'sendPosition';
      latitude: number;
      longitude: number;
      heading?: number | null;
      speed?: number | null;
    };

/**
 * Build a JS snippet to be passed to WebView.injectJavaScript().
 *
 * Targets the in-page helpers exposed by the PeerJS-based HTML built in
 * `jitsiHtml.ts`:
 *   - `window.bwToggleMute()`   flips localStream audio track.enabled.
 *   - `window.bwSetMuted(b)`    sets localStream audio track.enabled = !b.
 *   - `window.bwHangup()`       closes peer + connections + stops tracks.
 *
 * The previous Jitsi-targeted variants used DOM click-fallbacks against
 * toolbar buttons. That fallback is gone — PeerJS has no toolbar — so each
 * command simply delegates to the page-level helper and exits.
 *
 * Every snippet:
 *   - Wraps in an IIFE + try/catch so missing globals never crash the page.
 *   - Always terminates with `true;` so injectJavaScript() returns
 *     synchronously on Android.
 */
export function buildJitsiInjectionScript(cmd: JitsiCommand): string {
  switch (cmd.kind) {
    case 'toggleAudio':
      return wrap('if (typeof window.bwToggleMute === "function") { window.bwToggleMute(); }');

    case 'setAudioMuted': {
      const desired = cmd.muted ? 'true' : 'false';
      return wrap(
        'if (typeof window.bwSetMuted === "function") { window.bwSetMuted(' + desired + '); }',
      );
    }

    case 'setIncomingMuted': {
      // F30: muta o audio RECEBIDO local — nao toca em tracks remotas, so
      // seta audio.muted=true em cada <audio> element renderizado no DOM
      // da WebView. Quem ta na chamada nao percebe.
      const desired = cmd.muted ? 'true' : 'false';
      return wrap(
        'if (typeof window.bwSetIncomingMuted === "function") { window.bwSetIncomingMuted(' + desired + '); }',
      );
    }

    case 'hangup':
      return wrap('if (typeof window.bwHangup === "function") { window.bwHangup(); }');

    case 'setAudioOutput': {
      // No public API on the WebView page for switching audio output, and
      // PeerJS has nothing to do with output routing. We accept the command
      // for API symmetry and no-op it in JS so callers do not need a
      // platform branch.
      void cmd.deviceId;
      return wrap('/* setAudioOutput is a no-op in PeerJS strategy */');
    }

    case 'sendPosition': {
      // We must inline literal numbers (not stringified state) because the
      // WebView page has no shared scope with React Native; this is a
      // serialise-then-eval boundary. JSON.stringify handles the
      // `null` / `undefined` heading + speed cleanly.
      const lat = serializeNum(cmd.latitude);
      const lng = serializeNum(cmd.longitude);
      const hd = serializeNullableNum(cmd.heading);
      const sp = serializeNullableNum(cmd.speed);
      return wrap(
        'if (typeof window.bwSendPosition === "function") { window.bwSendPosition(' +
          lat +
          ',' +
          lng +
          ',' +
          hd +
          ',' +
          sp +
          '); }',
      );
    }

    default: {
      // Exhaustiveness — TS will flag a new variant here.
      const _exhaustive: never = cmd;
      void _exhaustive;
      return 'true;';
    }
  }
}

function wrap(body: string): string {
  return `(function(){try{${body}}catch(e){}})();true;`;
}

function serializeNum(value: number): string {
  // Reject NaN / Infinity at the boundary so we never emit `NaN` as a bare
  // identifier into the injected snippet (which would be a ReferenceError
  // inside the WebView). Falls back to `0` so the broadcast still fires
  // with a defined coordinate the receiver can reject.
  if (!Number.isFinite(value)) {
    return '0';
  }
  return String(value);
}

function serializeNullableNum(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'null';
  }
  return String(value);
}
