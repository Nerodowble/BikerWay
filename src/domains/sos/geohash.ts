/**
 * Geohash encoding/decoding minimalista para o canal de SOS Comunitario (F29.2).
 *
 * Por que reimplementar em vez de puxar uma lib: a unica funcao que
 * precisamos e `encode()` com precisao 4 — ~40km × 19km por celula no
 * Brasil — suficiente pra criar uma sala determinística por regiao. O
 * payload da lib `latlon-geohash` tem ~3kb minificada e a nossa
 * implementacao cabe em ~30 linhas. Mantem o catalog leve.
 *
 * Referencia do algoritmo:
 *   https://en.wikipedia.org/wiki/Geohash
 *
 * Tamanho aproximado das celulas em -23 lat (Brasil sudeste):
 *   precision 4 → 39km × 19km (escolhido para SOS de 15km)
 *   precision 5 →  5km ×  5km
 *   precision 6 →  1km ×  1km
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Encode latitude/longitude em geohash de precisao fixa.
 *
 * Lanca Error se receber NaN/Infinity ou precisao fora de [1, 12]. A
 * funcao e sincrona e barata (~5us no celular do user); pode chamar a
 * cada SOS sem cache.
 */
export function encodeGeohash(
  latitude: number,
  longitude: number,
  precision = 4,
): string {
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
    throw new Error('encodeGeohash: latitude/longitude precisam ser numericos');
  }
  if (latitude < -90 || latitude > 90) {
    throw new Error(`encodeGeohash: latitude ${latitude} fora de [-90,90]`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error(`encodeGeohash: longitude ${longitude} fora de [-180,180]`);
  }
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) {
    throw new Error(`encodeGeohash: precisao ${precision} fora de [1,12]`);
  }

  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let bit = 0;
  let ch = 0;
  let evenBit = true;
  let out = '';

  while (out.length < precision) {
    if (evenBit) {
      // bit de longitude
      const mid = (lngLo + lngHi) / 2;
      if (longitude >= mid) {
        ch = (ch << 1) + 1;
        lngLo = mid;
      } else {
        ch = ch << 1;
        lngHi = mid;
      }
    } else {
      // bit de latitude
      const mid = (latLo + latHi) / 2;
      if (latitude >= mid) {
        ch = (ch << 1) + 1;
        latLo = mid;
      } else {
        ch = ch << 1;
        latHi = mid;
      }
    }
    evenBit = !evenBit;
    bit += 1;
    if (bit === 5) {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return out;
}
