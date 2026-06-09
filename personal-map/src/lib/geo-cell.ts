/** Geohash semplice precisione 7 (~150 m) per consensus segnalazioni. */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let idx = 0;
  let bit = 0;
  let even = true;
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        idx = idx * 2 + 1;
        lngMin = mid;
      } else {
        idx = idx * 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx = idx * 2;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}

export function geohashCellId(lat: number, lng: number, kind: string): string {
  return `${encodeGeohash(lat, lng, 7)}:${kind}`;
}

export const HAZARD_CONSENSUS_THRESHOLD = 10;
