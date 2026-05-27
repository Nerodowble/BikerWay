import { buildGoogleMapsUrl } from '@/shared/components/poi/PoiListSheet';

/**
 * Regression guard: na primeira tentativa da F31, a URL embutia o nome
 * do POI antes das coords (`?query=Hotel Sunshine -23.6,-46.6`). Google
 * interpretava como busca textual e resolvia pro Hotel Sunshine mais
 * famoso (em Porto Seguro, 1479km longe) ignorando a coord. O fix foi
 * usar SOMENTE lat,lng no query — Google parseia como coords e dropa
 * pin no ponto exato.
 *
 * Esses testes travam a invariante "so coords" pra que ninguem
 * acidentalmente reintroduza o name na URL.
 */
describe('buildGoogleMapsUrl', () => {
  it('emite URL com apenas lat,lng no query', () => {
    const url = buildGoogleMapsUrl({ latitude: -23.681, longitude: -46.605 });
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=-23.681000,-46.605000',
    );
  });

  it('trunca coordenadas em 6 casas decimais (~11cm de precisao)', () => {
    const url = buildGoogleMapsUrl({
      latitude: -23.6812345678,
      longitude: -46.6054321099,
    });
    expect(url).toContain('-23.681235'); // arredondamento bancario do toFixed
    expect(url).toContain('-46.605432');
  });

  it('NAO embute name no query (regression guard do bug Hotel Sunshine)', () => {
    const poi = { latitude: -23.681, longitude: -46.605 };
    const url = buildGoogleMapsUrl(poi);
    // Sem espaco, sem letras alem do hostpath. Se alguem adicionar nome
    // de volta, vira "?query=Hotel%20Sunshine%20..." e o teste pega.
    const queryPart = url.split('&query=')[1] ?? '';
    expect(queryPart).toMatch(/^-?\d+\.\d{6},-?\d+\.\d{6}$/);
  });

  it('aceita coords positivas (hemisferio norte / leste)', () => {
    const url = buildGoogleMapsUrl({ latitude: 40.7128, longitude: -74.006 });
    expect(url).toContain('40.712800,-74.006000');
  });
});
