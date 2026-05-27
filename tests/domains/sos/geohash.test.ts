import { encodeGeohash } from '@/domains/sos/geohash';

describe('encodeGeohash', () => {
  it('codifica coords conhecidas com precisao 4 (sudeste BR)', () => {
    // Sao Paulo, capital — aproximadamente
    expect(encodeGeohash(-23.55, -46.63, 4)).toBe('6gyf');
    // Rio de Janeiro
    expect(encodeGeohash(-22.91, -43.17, 4)).toBe('75cm');
  });

  it('produz a mesma celula para pontos proximos (< ~10km no sudeste)', () => {
    const a = encodeGeohash(-23.5, -46.6, 4);
    const b = encodeGeohash(-23.45, -46.55, 4);
    expect(a).toBe(b);
  });

  it('produz celulas diferentes para pontos distantes', () => {
    const sp = encodeGeohash(-23.55, -46.63, 4);
    const rj = encodeGeohash(-22.91, -43.17, 4);
    expect(sp).not.toBe(rj);
  });

  it('permite ajustar a precisao', () => {
    expect(encodeGeohash(-23.55, -46.63, 1)).toHaveLength(1);
    expect(encodeGeohash(-23.55, -46.63, 5)).toHaveLength(5);
    expect(encodeGeohash(-23.55, -46.63, 12)).toHaveLength(12);
  });

  it('lanca erro com coordenadas invalidas', () => {
    expect(() => encodeGeohash(NaN, -46, 4)).toThrow(/numericos/);
    expect(() => encodeGeohash(-23, Infinity, 4)).toThrow(/numericos/);
    expect(() => encodeGeohash(-91, -46, 4)).toThrow(/latitude/);
    expect(() => encodeGeohash(-23, 181, 4)).toThrow(/longitude/);
  });

  it('lanca erro com precisao invalida', () => {
    expect(() => encodeGeohash(-23, -46, 0)).toThrow(/precisao/);
    expect(() => encodeGeohash(-23, -46, 13)).toThrow(/precisao/);
    expect(() => encodeGeohash(-23, -46, 1.5)).toThrow(/precisao/);
  });
});
