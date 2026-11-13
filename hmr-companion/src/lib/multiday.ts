import { estimateDurationMin } from "@/lib/route-time";
import type { UserRouteActivity } from "@/lib/sports";
import { elevationGainLossSmoothed } from "@/lib/track-geometry";

/** Punto del profilo: `[lng, lat, quota|null, km progressivo]` (come `StoredCoord`). */
export type ProfilePoint = readonly [number, number, number | null, number];

export type StagePoint = { lng: number; lat: number; ele: number | null; km: number };

/** Una tappa = un giorno di cammino tra due pernotti (o tra partenza/arrivo). */
export type Stage = {
  /** 1 = primo giorno. */
  day: number;
  from_km: number;
  to_km: number;
  length_km: number;
  gain_m: number;
  loss_m: number;
  max_ele_m: number | null;
  /** Tempo in movimento stimato (senza soste). */
  duration_min: number;
  start: StagePoint;
  end: StagePoint;
  /** Punto più alto della tappa. */
  high: StagePoint | null;
  /** Nome del pernotto a fine tappa (null sull'ultima). */
  overnight_name: string | null;
  /** La tappa finisce con una notte fuori. */
  overnight: boolean;
  /** Notte all'addiaccio/bivacco non custodito (esposta al vento). */
  overnight_exposed: boolean;
};

export type OvernightMark = { km: number; name?: string | null; exposed?: boolean };

function pointAt(profile: readonly ProfilePoint[], i: number): StagePoint {
  const p = profile[i];
  return { lng: p[0], lat: p[1], ele: p[2], km: p[3] };
}

/** Indice del primo punto con km ≥ quello richiesto. */
function indexAtKm(profile: readonly ProfilePoint[], km: number): number {
  let lo = 0;
  let hi = profile.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (profile[mid][3] < km) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildStage(
  profile: readonly ProfilePoint[],
  activity: UserRouteActivity,
  day: number,
  i0: number,
  i1: number,
  overnight: OvernightMark | null,
): Stage {
  const slice = profile.slice(i0, i1 + 1);
  const { gain, loss } = elevationGainLossSmoothed(slice.map((p) => p[2]));
  let high: StagePoint | null = null;
  for (let i = i0; i <= i1; i++) {
    const e = profile[i][2];
    if (e != null && (!high || e > (high.ele as number))) high = pointAt(profile, i);
  }
  const length = Math.max(0, profile[i1][3] - profile[i0][3]);
  return {
    day,
    from_km: profile[i0][3],
    to_km: profile[i1][3],
    length_km: Math.round(length * 100) / 100,
    gain_m: Math.round(gain),
    loss_m: Math.round(loss),
    max_ele_m: high?.ele != null ? Math.round(high.ele) : null,
    duration_min: estimateDurationMin(activity, length, gain, loss),
    start: pointAt(profile, i0),
    end: pointAt(profile, i1),
    high,
    overnight_name: overnight ? (overnight.name?.trim() || null) : null,
    overnight: overnight != null,
    overnight_exposed: overnight?.exposed === true,
  };
}

/**
 * Divide il profilo in tappe ai pernotti indicati (km lungo la traccia).
 * Pernotti fuori dal profilo o troppo vicini (< 200 m) a un estremo o tra loro
 * vengono ignorati. Senza pernotti restituisce un'unica tappa.
 */
export function buildStages(
  profile: readonly ProfilePoint[],
  overnights: readonly OvernightMark[],
  activity: UserRouteActivity,
): Stage[] {
  if (profile.length < 2) return [];
  const last = profile.length - 1;
  const total = profile[last][3];
  const MIN_GAP_KM = 0.2;
  const cuts: { i: number; mark: OvernightMark }[] = [];
  let prevKm = profile[0][3];
  for (const m of [...overnights].sort((a, b) => a.km - b.km)) {
    if (!Number.isFinite(m.km) || m.km - prevKm < MIN_GAP_KM || total - m.km < MIN_GAP_KM) continue;
    const i = indexAtKm(profile, m.km);
    if (i <= 0 || i >= last) continue;
    cuts.push({ i, mark: m });
    prevKm = m.km;
  }
  const stages: Stage[] = [];
  let i0 = 0;
  cuts.forEach((c, n) => {
    stages.push(buildStage(profile, activity, n + 1, i0, c.i, c.mark));
    i0 = c.i;
  });
  stages.push(buildStage(profile, activity, cuts.length + 1, i0, last, null));
  return stages;
}

/**
 * Propone i km dei pernotti per dividere il percorso in `days` giorni di
 * impegno (tempo stimato) simile.
 */
export function suggestOvernightKms(
  profile: readonly ProfilePoint[],
  days: number,
  activity: UserRouteActivity,
): number[] {
  const n = Math.floor(days);
  if (profile.length < 2 || n < 2) return [];
  // Impegno cumulato: tempo stimato a pezzi di ~500 m, così salita e discesa pesano.
  const effort: number[] = [0];
  let acc = 0;
  let anchor = 0;
  for (let i = 1; i < profile.length; i++) {
    if (profile[i][3] - profile[anchor][3] >= 0.5 || i === profile.length - 1) {
      const a = profile[anchor][2];
      const b = profile[i][2];
      const d = a != null && b != null ? b - a : 0;
      acc += estimateDurationMin(activity, profile[i][3] - profile[anchor][3], Math.max(0, d), Math.max(0, -d));
      anchor = i;
    }
    effort.push(acc);
  }
  if (!(acc > 0)) return [];
  const out: number[] = [];
  let j = 0;
  for (let k = 1; k < n; k++) {
    const target = (acc * k) / n;
    while (j < effort.length - 1 && effort[j] < target) j++;
    out.push(Math.round(profile[j][3] * 100) / 100);
  }
  return out;
}

/** Sopra questa quota conta la progressione della quota di pernotto (linee guida UIAA/WMS). */
export const ACCLIMATIZATION_FROM_M = 2500;
export const MAX_SLEEP_GAIN_M = 500;

/**
 * Avvisi di acclimatazione: quota di pernotto che sale di oltre 500 m rispetto
 * alla notte precedente, sopra i 2500 m.
 */
export function acclimatizationWarnings(stages: readonly Stage[]): { day: number; text: string }[] {
  const out: { day: number; text: string }[] = [];
  let prevSleep: number | null = stages[0]?.start.ele ?? null;
  for (const s of stages) {
    if (!s.overnight) continue;
    const sleep = s.end.ele;
    if (sleep != null && prevSleep != null && sleep >= ACCLIMATIZATION_FROM_M && sleep - prevSleep > MAX_SLEEP_GAIN_M) {
      out.push({
        day: s.day,
        text: `Notte ${s.day} a ${Math.round(sleep)} m: +${Math.round(sleep - prevSleep)} m rispetto alla notte prima (oltre i ${MAX_SLEEP_GAIN_M} m/giorno consigliati sopra ${ACCLIMATIZATION_FROM_M} m).`,
      });
    }
    if (sleep != null) prevSleep = sleep;
  }
  return out;
}

/** `YYYY-MM-DD` + n giorni (aritmetica di calendario, senza fusi). */
export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "HH:MM" + minuti → "HH:MM" e giorni di riporto. */
export function addMinutesToTime(hhmm: string, minutes: number): { time: string; dayOffset: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + Math.round(minutes);
  const dayOffset = Math.floor(total / 1440);
  const r = ((total % 1440) + 1440) % 1440;
  return { time: `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`, dayOffset };
}
