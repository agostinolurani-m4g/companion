import type { StopRow } from "@/lib/types";

/** Ordina per percorso (ordine globale). */
export function sortStopsByOrder(stops: StopRow[]): StopRow[] {
  return [...stops].sort((a, b) => a.order_index - b.order_index);
}

export function maxLegIndex(stops: StopRow[]): number {
  if (stops.length === 0) return -1;
  return Math.max(...stops.map((s) => s.leg_index ?? 0));
}

/** Conta i punti nell’ultima giornata (leg più alto). */
export function countStopsInLastLeg(sorted: StopRow[]): number {
  if (sorted.length === 0) return 0;
  const L = maxLegIndex(sorted);
  return sorted.filter((s) => (s.leg_index ?? 0) === L).length;
}

/**
 * Si può iniziare una nuova giornata solo se l’ultima giornata ha almeno 2 punti
 * (partenza + arrivo del segmento giornaliero). Ispirazione: planner multi-giorno (es. Komoot).
 */
export function canStartNextLeg(sorted: StopRow[]): boolean {
  if (sorted.length === 0) return false;
  return countStopsInLastLeg(sorted) >= 2;
}

/**
 * Indice globale `order_index` dove inserire un nuovo punto in coda alla giornata `legIndex`.
 */
export function appendInsertionOrderIndex(sorted: StopRow[], legIndex: number): number {
  let insertAt = 0;
  let foundInLeg = false;
  let maxOrderInLeg = -1;
  for (const s of sorted) {
    const L = s.leg_index ?? 0;
    if (L === legIndex) {
      foundInLeg = true;
      maxOrderInLeg = Math.max(maxOrderInLeg, s.order_index);
    }
  }
  if (foundInLeg) {
    return maxOrderInLeg + 1;
  }
  let maxBefore = -1;
  for (const s of sorted) {
    if ((s.leg_index ?? 0) < legIndex) {
      maxBefore = Math.max(maxBefore, s.order_index);
    }
  }
  return maxBefore + 1;
}

/** Raggruppa per leg_index mantenendo l’ordine globale. */
export function groupStopsByLeg(sorted: StopRow[]): Map<number, StopRow[]> {
  const m = new Map<number, StopRow[]>();
  for (const s of sorted) {
    const L = s.leg_index ?? 0;
    if (!m.has(L)) m.set(L, []);
    m.get(L)!.push(s);
  }
  return m;
}
