/**
 * Dove inserire una nuova tappa in un percorso già calcolato.
 *
 * Il vecchio metodo misurava la distanza dalla retta tra due tappe: con un tracciato che
 * gira attorno a una valle la retta passa altrove, la tappa finiva nel tratto sbagliato e
 * il percorso faceva avanti e indietro. Qui si usa il tracciato vero:
 *  - punto vicino al tracciato → si proietta sulla linea e si inserisce nel tratto dove cade;
 *  - punto lontano → il tratto che allunga meno il giro (deviazione minima).
 */

export type LngLat = { lng: number; lat: number };

/** Distanza in metri (equirettangolare: abbondante per distanze di pochi km). */
function meters(a: LngLat, b: LngLat): number {
  const kx = 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (b.lng - a.lng) * kx;
  const dy = (b.lat - a.lat) * 110_540;
  return Math.hypot(dx, dy);
}

/** Distanza (m) di p dal segmento a–b. */
function distToSegment(p: LngLat, a: LngLat, b: LngLat): number {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  const ax = (a.lng - p.lng) * kx;
  const ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx;
  const by = (b.lat - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

const pt = (c: [number, number]): LngLat => ({ lng: c[0], lat: c[1] });

/**
 * Per ogni tappa, l'indice del vertice del tracciato dove passa (crescente).
 * Cerca sempre in avanti dalla tappa precedente; tra vertici quasi equidistanti prende il
 * primo, così in un andata-e-ritorno la tappa non salta al passaggio di ritorno.
 */
export function waypointRouteIndexes(route: [number, number][], wps: LngLat[]): number[] {
  const out: number[] = [];
  let from = 0;
  for (let w = 0; w < wps.length; w++) {
    if (w === wps.length - 1) {
      out.push(route.length - 1);
      break;
    }
    if (w === 0) {
      out.push(0);
      continue;
    }
    let best = Infinity;
    const d: number[] = [];
    for (let i = from; i < route.length; i++) {
      const v = meters(wps[w], pt(route[i]));
      d.push(v);
      if (v < best) best = v;
    }
    const tol = best + 30;
    let idx = from;
    for (let k = 0; k < d.length; k++) {
      if (d[k] <= tol) {
        idx = from + k;
        break;
      }
    }
    out.push(idx);
    from = idx;
  }
  return out;
}

/** Vertice del tracciato più vicino al punto: segmento k (tra route[k] e route[k+1]) e distanza. */
export function projectOnRoute(route: [number, number][], p: LngLat): { segment: number; distM: number } | null {
  if (route.length < 2) return null;
  let best = { segment: 0, distM: Infinity };
  for (let k = 0; k < route.length - 1; k++) {
    const d = distToSegment(p, pt(route[k]), pt(route[k + 1]));
    if (d < best.distM) best = { segment: k, distM: d };
  }
  return best;
}

/** Tratto che allunga meno il percorso aggiungendo p (indice di inserimento 1..n-1). */
export function minDetourInsertIndex(wps: LngLat[], p: LngLat): number {
  let bestIdx = 1;
  let bestCost = Infinity;
  for (let i = 0; i < wps.length - 1; i++) {
    const cost = meters(wps[i], p) + meters(p, wps[i + 1]) - meters(wps[i], wps[i + 1]);
    if (cost < bestCost) {
      bestCost = cost;
      bestIdx = i + 1;
    }
  }
  return bestIdx;
}

/** Oltre questa distanza dal tracciato il punto è "fuori": si usa la deviazione minima. */
export const NEAR_ROUTE_M = 250;

/**
 * Indice dove inserire p tra le tappe (p va tra wps[idx-1] e wps[idx]).
 * Con meno di 2 tappe: in coda.
 */
export function insertIndexForPoint(
  wps: LngLat[],
  p: LngLat,
  route?: [number, number][] | null,
): { index: number; nearRoute: boolean; distM: number | null } {
  if (wps.length < 2) return { index: wps.length, nearRoute: false, distM: null };
  if (route && route.length >= 2) {
    const proj = projectOnRoute(route, p);
    if (proj && proj.distM <= NEAR_ROUTE_M) {
      const idxs = waypointRouteIndexes(route, wps);
      // Il tratto j va dalla tappa j alla j+1: l'ultimo il cui vertice di partenza è <= segmento.
      let leg = 0;
      for (let j = 0; j < wps.length - 1; j++) {
        if (idxs[j] <= proj.segment) leg = j;
      }
      return { index: leg + 1, nearRoute: true, distM: proj.distM };
    }
    return { index: minDetourInsertIndex(wps, p), nearRoute: false, distM: proj?.distM ?? null };
  }
  return { index: minDetourInsertIndex(wps, p), nearRoute: false, distM: null };
}
