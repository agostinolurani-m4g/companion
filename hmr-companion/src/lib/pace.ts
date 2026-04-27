import type { StoredCoord } from "./track-coords";

export type PaceConfig = {
  /** velocità media su asfalto (salite/discese dolci o piano), km/h */
  tarmacKmh: number;
  /** velocità media su sterrato/gravel rideable, km/h */
  gravelKmh: number;
  /** velocità hike-a-bike (spingi) su rampe ripide, km/h */
  hikeKmh: number;
  /** moltiplicatore extra per stanchezza (1.0 = nessun penalty) */
  fatigueMult: number;
};

export const DEFAULT_PACE: PaceConfig = {
  tarmacKmh: 22,
  gravelKmh: 12,
  hikeKmh: 4,
  fatigueMult: 1.0,
};

const PACE_STORAGE_KEY = "hmr.pace.v1";

export function loadPace(): PaceConfig {
  if (typeof window === "undefined") return DEFAULT_PACE;
  try {
    const raw = window.localStorage.getItem(PACE_STORAGE_KEY);
    if (!raw) return DEFAULT_PACE;
    const parsed = JSON.parse(raw) as Partial<PaceConfig>;
    return {
      tarmacKmh: clamp(parsed.tarmacKmh ?? DEFAULT_PACE.tarmacKmh, 5, 45),
      gravelKmh: clamp(parsed.gravelKmh ?? DEFAULT_PACE.gravelKmh, 3, 30),
      hikeKmh: clamp(parsed.hikeKmh ?? DEFAULT_PACE.hikeKmh, 1.5, 8),
      fatigueMult: clamp(parsed.fatigueMult ?? DEFAULT_PACE.fatigueMult, 0.7, 1.8),
    };
  } catch {
    return DEFAULT_PACE;
  }
}

export function savePace(p: PaceConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PACE_STORAGE_KEY, JSON.stringify(p));
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Stima il tempo (ore) per percorrere un segmento di lunghezza `distKm`
 * con pendenza media `grade` (frazione, es. 0.05 = 5%).
 */
function segmentHours(distKm: number, grade: number, pace: PaceConfig): number {
  const absG = Math.abs(grade);
  let speed: number;
  if (absG < 0.03) speed = pace.tarmacKmh * 0.92 + pace.gravelKmh * 0.08;
  else if (absG < 0.08) speed = pace.gravelKmh;
  else if (absG < 0.12) speed = pace.gravelKmh * 0.55 + pace.hikeKmh * 0.45;
  else speed = pace.hikeKmh;
  if (grade < -0.06) speed = Math.max(speed, 18);
  return distKm / Math.max(1, speed);
}

/**
 * Stima le ore rimanenti dalla posizione `fromKm` fino a `toKm`, iterando
 * sui vertici della traccia e applicando il pace per fascia di pendenza.
 */
export function estimateHoursBetween(
  storedCoords: StoredCoord[],
  fromKm: number,
  toKm: number,
  pace: PaceConfig
): number {
  if (toKm <= fromKm) return 0;
  let hours = 0;
  let prevKm = fromKm;
  let prevElev = elevAt(storedCoords, fromKm);
  for (let i = 0; i < storedCoords.length; i++) {
    const km = storedCoords[i][3];
    if (km <= fromKm) continue;
    if (km >= toKm) break;
    const elev = storedCoords[i][2];
    const dist = km - prevKm;
    if (dist > 0) {
      const dElev = (elev ?? prevElev ?? 0) - (prevElev ?? 0);
      const grade = dist > 0 ? dElev / (dist * 1000) : 0;
      hours += segmentHours(dist, grade, pace);
    }
    prevKm = km;
    prevElev = elev ?? prevElev;
  }
  if (toKm > prevKm) {
    const elevEnd = elevAt(storedCoords, toKm);
    const dist = toKm - prevKm;
    const dElev = (elevEnd ?? prevElev ?? 0) - (prevElev ?? 0);
    const grade = dist > 0 ? dElev / (dist * 1000) : 0;
    hours += segmentHours(dist, grade, pace);
  }
  return hours * pace.fatigueMult;
}

function elevAt(stored: StoredCoord[], km: number): number | null {
  if (stored.length === 0) return null;
  if (km <= stored[0][3]) return stored[0][2];
  if (km >= stored[stored.length - 1][3]) return stored[stored.length - 1][2];
  let lo = 0;
  let hi = stored.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (stored[mid][3] <= km) lo = mid;
    else hi = mid;
  }
  const a = stored[lo];
  const b = stored[hi];
  if (a[2] == null && b[2] == null) return null;
  if (a[2] == null) return b[2];
  if (b[2] == null) return a[2];
  const seg = b[3] - a[3];
  const t = seg < 1e-9 ? 0 : (km - a[3]) / seg;
  return a[2] + t * (b[2] - a[2]);
}

export type EtaComputation = {
  etaMs: number;
  remainingHours: number;
  cutoffStatus: "green" | "yellow" | "red" | "none";
  marginHours: number;
};

export function computeEta(
  storedCoords: StoredCoord[],
  atKm: number,
  targetKm: number,
  pace: PaceConfig,
  cutoffUtc: number | null,
  nowMs: number
): EtaComputation {
  const remaining = estimateHoursBetween(storedCoords, atKm, targetKm, pace);
  const etaMs = nowMs + remaining * 3600_000;
  let cutoffStatus: EtaComputation["cutoffStatus"] = "none";
  let margin = 0;
  if (cutoffUtc != null && Number.isFinite(cutoffUtc)) {
    margin = (cutoffUtc - etaMs) / 3600_000;
    if (margin >= 2) cutoffStatus = "green";
    else if (margin >= 0) cutoffStatus = "yellow";
    else cutoffStatus = "red";
  }
  return { etaMs, remainingHours: remaining, cutoffStatus, marginHours: margin };
}

export function formatHours(h: number): string {
  if (!Number.isFinite(h)) return "—";
  const sign = h < 0 ? "-" : "";
  const abs = Math.abs(h);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  return `${sign}${hh}h${mm.toString().padStart(2, "0")}`;
}

export function formatRelative(toMs: number, nowMs: number): string {
  const diff = toMs - nowMs;
  const abs = Math.abs(diff);
  const H = 3600_000;
  if (abs < 60_000) return diff >= 0 ? "< 1 min" : "passato";
  if (abs < H) return `${Math.round(diff / 60_000)} min`;
  const hours = diff / H;
  return formatHours(hours);
}
