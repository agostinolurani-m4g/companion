/**
 * Punti vicino a un percorso, ordinati lungo il percorso (km dalla partenza).
 * Proiezione equirettangolare locale: precisa a sufficienza entro qualche km dalla linea.
 */

export type AlongHit<T> = { item: T; distM: number; alongKm: number };

const M_PER_DEG = 111_320;

export function routeLengthKm(route: [number, number][]): number {
  if (route.length < 2) return 0;
  const k = Math.cos((route[0][1] * Math.PI) / 180);
  let s = 0;
  for (let i = 1; i < route.length; i++) {
    s += Math.hypot((route[i][0] - route[i - 1][0]) * k, route[i][1] - route[i - 1][1]) * M_PER_DEG;
  }
  return s / 1000;
}

/** Bbox del percorso allargato di `padM` metri: [south, west, north, east]. */
export function routeBbox(route: [number, number][], padM: number): [number, number, number, number] {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const [lng, lat] of route) {
    s = Math.min(s, lat);
    n = Math.max(n, lat);
    w = Math.min(w, lng);
    e = Math.max(e, lng);
  }
  const dLat = padM / M_PER_DEG;
  const dLng = padM / (M_PER_DEG * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [s - dLat, w - dLng, n + dLat, e + dLng];
}

export function pointsAlongRoute<T extends { lat: number; lng: number }>(
  route: [number, number][],
  points: T[],
  maxDistM: number,
): AlongHit<T>[] {
  if (route.length < 2 || !points.length) return [];
  const k = Math.cos((route[0][1] * Math.PI) / 180);
  const xy = route.map(([lng, lat]) => [lng * k * M_PER_DEG, lat * M_PER_DEG] as const);
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const out: AlongHit<T>[] = [];
  for (const p of points) {
    const px = p.lng * k * M_PER_DEG;
    const py = p.lat * M_PER_DEG;
    let best = Infinity;
    let along = 0;
    for (let i = 0; i < xy.length - 1; i++) {
      const [ax, ay] = xy[i];
      const [bx, by] = xy[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best) {
        best = d;
        along = cum[i] + t * Math.sqrt(len2);
      }
    }
    if (best <= maxDistM) out.push({ item: p, distM: Math.round(best), alongKm: Math.round(along) / 1000 });
  }
  return out.sort((a, b) => a.alongKm - b.alongKm);
}
