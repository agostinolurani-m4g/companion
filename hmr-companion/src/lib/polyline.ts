/**
 * Decoder / encoder per il formato "Encoded Polyline" (Google, usato da Strava
 * in `map.summary_polyline` e `map.polyline`). Restituisce coordinate GeoJSON
 * `[lng, lat]`.
 */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;
  while (index < len) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    out.push([lng / factor, lat / factor]);
  }
  return out;
}

function encodeValue(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let s = "";
  while (n >= 0x20) {
    s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return s + String.fromCharCode(n + 63);
}

/** Codifica coordinate `[lng, lat]` (usato nei test e per payload compatti). */
export function encodePolyline(coords: [number, number][], precision = 5): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLng = 0;
  let out = "";
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * factor);
    const ln = Math.round(lng * factor);
    out += encodeValue(la - prevLat) + encodeValue(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}
