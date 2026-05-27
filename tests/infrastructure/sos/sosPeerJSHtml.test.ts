import {
  SOS_BRIDGE_VERSION,
  buildSosPeerJSHtml,
} from '@/infrastructure/sos/sosPeerJSHtml';

/**
 * Cobertura da geracao do HTML da WebView SOS (F29.2b). Nao executa o
 * script — so verifica que strings criticas estao presentes e que a
 * sanitizacao do geohash funciona.
 */
describe('buildSosPeerJSHtml', () => {
  it('embute o geohash no broker id', () => {
    const html = buildSosPeerJSHtml({ geohash: '6gyf' });
    expect(html).toContain("'6gyf'");
    expect(html).toContain('bw-sos-broker-');
  });

  it('sanitiza caracteres especiais e injection attempts no geohash', () => {
    const html = buildSosPeerJSHtml({ geohash: "6g'y\";f" });
    // Aspas, quebra de linha e ; foram removidas. Restou so [A-Za-z0-9].
    const match = html.match(/var GEOHASH = '([^']*)'/);
    expect(match).not.toBeNull();
    const sanitized = match?.[1] ?? '';
    expect(/^[a-z0-9]+$/.test(sanitized)).toBe(true);
    // Garante que o ; injetado nao escapou pro JS
    expect(html).not.toContain("6g';");
  });

  it('inclui o script do PeerJS via unpkg', () => {
    const html = buildSosPeerJSHtml({ geohash: '6gyf' });
    expect(html).toContain('peerjs@1.5.4');
  });

  it('expoe SOS_BRIDGE_VERSION coerente com o snippet', () => {
    const html = buildSosPeerJSHtml({ geohash: '6gyf' });
    expect(html).toContain(`var BRIDGE_VERSION = ${SOS_BRIDGE_VERSION}`);
  });

  it('expoe as 3 funcoes do bridge na pagina', () => {
    const html = buildSosPeerJSHtml({ geohash: '6gyf' });
    expect(html).toContain('window.bwSosInit');
    expect(html).toContain('window.bwSosBroadcast');
    expect(html).toContain('window.bwSosTeardown');
  });

  it('limita o geohash a 12 chars (defensivo contra ID monstro)', () => {
    const longInput = '0123456789bcdefghjkmnp';
    const html = buildSosPeerJSHtml({ geohash: longInput });
    // O literal embedded deve ter exatamente 12 chars
    const match = html.match(/var GEOHASH = '([^']*)'/);
    expect(match).not.toBeNull();
    expect(match?.[1]?.length).toBeLessThanOrEqual(12);
  });
});
