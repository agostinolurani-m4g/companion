/** Fallback se non si legge lo zoom (compat). */
export const TRACK_SNAP_MAX_DIST_KM = 0.08;

/**
 * Distanza max (km) dal cursore alla traccia per snap: più stretta a zoom alto,
 * più tollerante a zoom basso (parametri in km).
 */
export function trackSnapMaxDistKm(zoom: number): number {
  const z = Math.max(6, Math.min(18, zoom));
  const minKm = 0.032;
  const maxKm = 0.2;
  const t = (18 - z) / 12;
  return minKm + (maxKm - minKm) * Math.min(1, Math.max(0, t));
}
