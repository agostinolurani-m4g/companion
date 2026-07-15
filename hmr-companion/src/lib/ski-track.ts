import { lineLengthKm } from "@/lib/osrm-route";
import type { RouteColoredSegment } from "@/lib/ors-route-tech";

/** Distanza massima tra due tappe cliccate (km). */
export const SKI_MAX_WAYPOINT_GAP_KM = 1;

/** Campionamento lungo il tratto per profilo e pendenza (m). */
export const SKI_DENSIFY_STEP_M = 50;

/** Pendenza % oltre la quale segnalare attenzione (~20°). */
export const SKI_GRADE_WARN_PCT = 35;

/** Pendenza % critica (~27°). */
export const SKI_GRADE_ALERT_PCT = 50;

export type SteepSegment = {
  kmStart: number;
  kmEnd: number;
  gradePctMax: number;
  elevDeltaM: number;
  severity: "warn" | "alert";
};

function haversineM(a: [number, number], b: [number, number]): number {
  return lineLengthKm([a, b]) * 1000;
}

function interpolate(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Distanza in km tra due waypoint consecutivi. */
export function waypointGapKm(
  prev: { lng: number; lat: number },
  next: { lng: number; lat: number },
): number {
  return lineLengthKm([[prev.lng, prev.lat], [next.lng, next.lat]]);
}

export function validateWaypointGap(
  prev: { lng: number; lat: number } | null,
  next: { lng: number; lat: number },
  maxGapKm = SKI_MAX_WAYPOINT_GAP_KM,
): { ok: true } | { ok: false; distanceKm: number; maxGapKm: number } {
  if (!prev) return { ok: true };
  const distanceKm = waypointGapKm(prev, next);
  if (distanceKm <= maxGapKm) return { ok: true };
  return { ok: false, distanceKm, maxGapKm };
}

/**
 * Linea diretta tra tappe, densificata ogni `stepM` metri (non segue sentieri).
 */
export function buildTrackFromWaypoints(
  waypoints: { lng: number; lat: number }[],
  stepM = SKI_DENSIFY_STEP_M,
): [number, number][] {
  if (waypoints.length < 2) return [];
  const vertices = waypoints.map((w) => [w.lng, w.lat] as [number, number]);
  const out: [number, number][] = [vertices[0]];
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const distM = haversineM(a, b);
    if (distM <= stepM) {
      out.push(b);
      continue;
    }
    const n = Math.ceil(distM / stepM);
    for (let k = 1; k < n; k++) {
      out.push(interpolate(a, b, k / n));
    }
    out.push(b);
  }
  return out;
}

/** Pendenza % tra campioni consecutivi (orizzontale ≈ distanza along-track). */
export function gradesAlongProfile(
  distanceKm: number[],
  elevationM: number[],
): { km: number; gradePct: number; distM: number; elevDeltaM: number }[] {
  const out: { km: number; gradePct: number; distM: number; elevDeltaM: number }[] = [];
  for (let i = 1; i < elevationM.length; i++) {
    const e0 = elevationM[i - 1];
    const e1 = elevationM[i];
    if (e0 == null || e1 == null || !Number.isFinite(e0) || !Number.isFinite(e1)) continue;
    const distM = (distanceKm[i] - distanceKm[i - 1]) * 1000;
    if (distM < 1) continue;
    const elevDeltaM = e1 - e0;
    const gradePct = (elevDeltaM / distM) * 100;
    out.push({ km: distanceKm[i], gradePct, distM, elevDeltaM });
  }
  return out;
}

/** Tratti con pendenza eccessiva (aggregati su campioni consecutivi). */
export function findSteepSegments(
  distanceKm: number[],
  elevationM: number[],
  opts?: { warnPct?: number; alertPct?: number },
): SteepSegment[] {
  const warnPct = opts?.warnPct ?? SKI_GRADE_WARN_PCT;
  const alertPct = opts?.alertPct ?? SKI_GRADE_ALERT_PCT;
  const samples = gradesAlongProfile(distanceKm, elevationM);
  const segments: SteepSegment[] = [];
  let cur: SteepSegment | null = null;

  const flush = () => {
    if (cur) segments.push(cur);
    cur = null;
  };

  for (const s of samples) {
    const absGrade = Math.abs(s.gradePct);
    if (absGrade < warnPct) {
      flush();
      continue;
    }
    const severity: "warn" | "alert" = absGrade >= alertPct ? "alert" : "warn";
    const kmStart = s.km - s.distM / 2000;
    const kmEnd = s.km;
    if (!cur || severity !== cur.severity) {
      flush();
      cur = {
        kmStart,
        kmEnd,
        gradePctMax: absGrade,
        elevDeltaM: s.elevDeltaM,
        severity,
      };
    } else {
      cur.kmEnd = kmEnd;
      cur.gradePctMax = Math.max(cur.gradePctMax, absGrade);
      cur.elevDeltaM += s.elevDeltaM;
    }
  }
  flush();
  return segments;
}

/** Interpola quota sul profilo densificato (km cumulati sulla linea). */
export function elevationProfileAlongCoords(
  coords: [number, number][],
  sampled: [number, number][],
  profileDistKm: number[],
  profileElevM: number[],
): { distanceKm: number[]; elevationM: number[] } {
  const distanceKm: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    distanceKm.push(distanceKm[i - 1] + lineLengthKm([coords[i - 1], coords[i]]));
  }
  const elevationM = coords.map((_, i) => {
    const km = distanceKm[i];
    if (profileDistKm.length === 0) return null;
    if (km <= profileDistKm[0]) return profileElevM[0] ?? null;
    const last = profileDistKm.length - 1;
    if (km >= profileDistKm[last]) return profileElevM[last] ?? null;
    let j = 1;
    while (j < profileDistKm.length && profileDistKm[j] < km) j++;
    const k0 = profileDistKm[j - 1];
    const k1 = profileDistKm[j];
    const e0 = profileElevM[j - 1];
    const e1 = profileElevM[j];
    if (e0 == null || e1 == null || k1 <= k0) return e0 ?? e1 ?? null;
    const t = (km - k0) / (k1 - k0);
    return e0 + (e1 - e0) * t;
  });
  return { distanceKm, elevationM: elevationM as number[] };
}

const STEEP_COLORS = {
  warn: "#f97316",
  alert: "#dc2626",
} as const;

/** Segmenti mappa: colore base + evidenza tratti ripidi. */
export function buildTrackColoredSegments(
  coords: [number, number][],
  distanceKm: number[],
  elevationM: number[],
  baseColor: string,
): RouteColoredSegment[] {
  if (coords.length < 2) return [];
  const steep = findSteepSegments(distanceKm, elevationM);
  if (steep.length === 0) {
    return [{ coordinates: coords, color: baseColor, surface: "unknown" }];
  }

  const steepFlags = new Array<boolean>(coords.length).fill(false);
  const steepSeverity = new Array<"warn" | "alert" | null>(coords.length).fill(null);

  for (const seg of steep) {
    for (let i = 1; i < coords.length; i++) {
      const km = distanceKm[i] ?? 0;
      if (km >= seg.kmStart && km <= seg.kmEnd + 1e-6) {
        steepFlags[i] = true;
        steepFlags[i - 1] = true;
        steepSeverity[i] = seg.severity;
        steepSeverity[i - 1] = seg.severity;
      }
    }
  }

  const out: RouteColoredSegment[] = [];
  let i = 0;
  while (i < coords.length - 1) {
    const isSteep = steepFlags[i] || steepFlags[i + 1];
    const sev = steepSeverity[i] ?? steepSeverity[i + 1];
    const color = isSteep && sev ? STEEP_COLORS[sev] : baseColor;
    const start = i;
    i++;
    while (
      i < coords.length - 1 &&
      (steepFlags[i] || steepFlags[i + 1]) === isSteep &&
      (steepSeverity[i] ?? steepSeverity[i + 1]) === sev
    ) {
      i++;
    }
    out.push({
      coordinates: coords.slice(start, i + 1),
      color,
      surface: "unknown",
    });
  }
  return out;
}
