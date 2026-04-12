/**
 * Encoded polyline (Google) per anteprime compatte nei tool (nessuna lista enorme di coordinate).
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

function encodeSigned(n: number): string {
  let v = n < 0 ? ~(n << 1) : n << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

/** lng,lat in gradi → stringa encoded (precisione 5 decimali ~ 1m). */
export function encodePolyline(coordinates: [number, number][], precision = 5): string {
  const factor = 10 ** precision;
  let lat = 0;
  let lng = 0;
  let out = "";
  for (const c of coordinates) {
    const lati = Math.round(c[1] * factor);
    const lngi = Math.round(c[0] * factor);
    out += encodeSigned(lati - lat);
    out += encodeSigned(lngi - lng);
    lat = lati;
    lng = lngi;
  }
  return out;
}

/** Campiona al massimo `max` punti (inclusi estremi) per encoding. */
export function sampleForPreview(coords: [number, number][], max: number): [number, number][] {
  if (coords.length <= max) return coords;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i / (max - 1)) * (coords.length - 1));
    out.push(coords[idx]);
  }
  return out;
}
