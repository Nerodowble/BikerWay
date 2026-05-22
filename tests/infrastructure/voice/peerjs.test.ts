import {
  buildJitsiHtml,
  buildJitsiInjectedJs,
  buildJitsiUrl,
} from '../../../src/infrastructure/voice/jitsiHtml';
import { buildJitsiInjectionScript } from '../../../src/infrastructure/voice/jitsiCommands';

describe('buildJitsiUrl (PeerJS strategy)', () => {
  it('returns about:blank so JitsiWebView can switch to the html source path', () => {
    expect(buildJitsiUrl({ roomName: 'bw-test', displayName: 'X' })).toBe('about:blank');
  });
});

describe('buildJitsiInjectedJs (PeerJS strategy)', () => {
  it('returns a syntactically valid no-op snippet ending with true', () => {
    const js = buildJitsiInjectedJs();
    expect(typeof js).toBe('string');
    expect(js.trim().endsWith('true;')).toBe(true);
  });
});

describe('buildJitsiHtml (PeerJS strategy)', () => {
  const html = buildJitsiHtml({ roomName: 'bw-test', displayName: 'Piloto' });

  it('returns a string starting with an HTML doctype', () => {
    expect(typeof html).toBe('string');
    expect(html.toLowerCase()).toContain('<!doctype html>');
  });

  it('embeds the PeerJS CDN script tag', () => {
    expect(html).toContain('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js');
  });

  it('interpolates the room code into the host id template', () => {
    expect(html).toContain("var ROOM = 'bw-test';");
    expect(html).toContain("var HOST_ID = 'bw-' + ROOM + '-host';");
  });

  it('interpolates the display name safely inside a single-quoted JS literal', () => {
    expect(html).toContain("var DISPLAY_NAME = 'Piloto';");
  });

  it('escapes single quotes inside the display name so the JS literal stays valid', () => {
    const trickyHtml = buildJitsiHtml({
      roomName: 'bw-test',
      displayName: "O'Neil",
    });
    expect(trickyHtml).toContain("var DISPLAY_NAME = 'O\\'Neil';");
    expect(trickyHtml).not.toContain("var DISPLAY_NAME = 'O'Neil';");
  });

  it('does NOT contain raw line breaks injected from the display name', () => {
    const trickyHtml = buildJitsiHtml({
      roomName: 'bw-test',
      displayName: 'line1\nline2',
    });
    expect(trickyHtml).toContain("var DISPLAY_NAME = 'line1\\nline2';");
  });

  it('strips disallowed characters from the room name before embedding it', () => {
    const trickyHtml = buildJitsiHtml({
      roomName: "bw-test'; alert(1);//",
      displayName: 'X',
    });
    // Only [A-Za-z0-9_-] survives sanitisation; the dangerous quote/semicolon
    // sequence must not appear verbatim inside the embedded JS literal.
    expect(trickyHtml).toContain("var ROOM = 'bw-testalert1';");
    expect(trickyHtml).not.toContain("'; alert(1);//");
  });

  it('exposes the three window helpers expected by the host bridge', () => {
    expect(html).toContain('window.bwToggleMute');
    expect(html).toContain('window.bwSetMuted');
    expect(html).toContain('window.bwHangup');
  });

  it('honours startMuted by initialising the muted flag to true', () => {
    const mutedHtml = buildJitsiHtml({
      roomName: 'bw-test',
      displayName: 'X',
      startMuted: true,
    });
    expect(mutedHtml).toContain('var START_MUTED = true;');
    const liveHtml = buildJitsiHtml({
      roomName: 'bw-test',
      displayName: 'X',
      startMuted: false,
    });
    expect(liveHtml).toContain('var START_MUTED = false;');
  });

  it('declares the pluggable transport object with all four contract functions', () => {
    expect(html).toContain('var transport = {');
    expect(html).toMatch(/init:\s*function/);
    expect(html).toMatch(/announce:\s*function/);
    expect(html).toMatch(/onPeerListChanged:\s*function/);
    expect(html).toMatch(/dispose:\s*function/);
  });
});

describe('buildJitsiInjectionScript (PeerJS strategy)', () => {
  it('toggleAudio references the in-page window.bwToggleMute helper', () => {
    const js = buildJitsiInjectionScript({ kind: 'toggleAudio' });
    expect(js).toContain('window.bwToggleMute');
    expect(js.trim().endsWith('true;')).toBe(true);
  });

  it('setAudioMuted true delegates to window.bwSetMuted(true)', () => {
    const js = buildJitsiInjectionScript({ kind: 'setAudioMuted', muted: true });
    expect(js).toContain('window.bwSetMuted(true)');
  });

  it('setAudioMuted false delegates to window.bwSetMuted(false)', () => {
    const js = buildJitsiInjectionScript({ kind: 'setAudioMuted', muted: false });
    expect(js).toContain('window.bwSetMuted(false)');
  });

  it('hangup references the in-page window.bwHangup helper', () => {
    const js = buildJitsiInjectionScript({ kind: 'hangup' });
    expect(js).toContain('window.bwHangup');
  });

  it('setAudioOutput is a no-op snippet that still terminates with true', () => {
    const js = buildJitsiInjectionScript({ kind: 'setAudioOutput', deviceId: 'speaker' });
    expect(js).toContain('no-op');
    expect(js.trim().endsWith('true;')).toBe(true);
  });
});
