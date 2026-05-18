"use client";

import { useId, useMemo, useRef } from "react";
import type { CheckpointRow, NotableSectionRow, RacePlanItemRow } from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import type { TrackSurfaceKind } from "@/lib/surface-osm";
import { coordAtKm, measureBetween } from "@/lib/track-measure";

export type ElevationRaceItem = Pick<RacePlanItemRow, "id" | "km_start" | "km_end" | "kind" | "title">;
export type { RacePlanItemKind } from "@/lib/race-plan-types";

export type ElevationChartProps = {
  coords: StoredCoord[];
  sections: NotableSectionRow[];
  checkpoints: CheckpointRow[];
  atKm: number | null;
  hoverKm?: number | null;
  pinAKm?: number | null;
  pinBKm?: number | null;
  onHoverKm?: (km: number | null) => void;
  onPinKm?: (km: number) => void;
  /** Trascina sul grafico: imposta arco A–B (km ordinati). */
  onPinRange?: (loKm: number, hiKm: number) => void;
  /** Annotazioni del piano gara attivo (sopra le sezioni, sotto la banda misura) */
  raceItems?: ElevationRaceItem[];
  /** Fasce km per superficie (da snapshot OSM); sotto sezioni “toughest”. */
  surfaceBands?: Array<{ km_start: number; km_end: number; surface: TrackSurfaceKind }>;
  /** Testo terreno al km del cursore (tooltip). */
  hoverTerrainLabel?: string | null;
  /** Da DB (ingest): D+/D- segmento proporzionali al GPX grezzo ITRA. */
  elevProfileGainScale?: number;
  elevProfileLossScale?: number;
  /** Se entrambi valorizzati, zoom orizzontale su questo tratto (tipicamente pin A–B fissi). */
  zoomKmLo?: number | null;
  zoomKmHi?: number | null;
  /** Classi aggiuntive sul wrapper esterno (es. altezza striscia fissa). */
  wrapperClassName?: string;
};

const CHART_W = 720;
const CHART_H = 132;
const PAD_L = 32;
const PAD_R = 12;
const PAD_T = 8;
const PAD_B = 16;

function clientToViewBox(
  clientX: number,
  clientY: number,
  el: SVGSVGElement,
  vbW: number,
  vbH: number
): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const scale = Math.min(rect.width / vbW, rect.height / vbH);
  const ox = (rect.width - scale * vbW) / 2;
  const oy = (rect.height - scale * vbH) / 2;
  return {
    x: (clientX - rect.left - ox) / scale,
    y: (clientY - rect.top - oy) / scale,
  };
}

function zoomPadKm(lo: number, hi: number, totalKm: number): { vMin: number; vMax: number } {
  const span = Math.max(1e-3, hi - lo);
  const pad = Math.max(0.2, span * 0.1);
  return {
    vMin: Math.max(0, lo - pad),
    vMax: Math.min(totalKm, hi + pad),
  };
}

function elevRangeInWindow(coords: StoredCoord[], k0: number, k1: number): { minElev: number; maxElev: number } {
  let minE = Infinity;
  let maxE = -Infinity;
  for (const c of coords) {
    const k = c[3];
    if (k < k0 || k > k1) continue;
    if (c[2] != null) {
      minE = Math.min(minE, c[2]);
      maxE = Math.max(maxE, c[2]);
    }
  }
  if (!Number.isFinite(minE) || !Number.isFinite(maxE)) {
    return { minElev: 0, maxElev: 1 };
  }
  const pad = Math.max(8, (maxE - minE) * 0.08);
  return { minElev: minE - pad, maxElev: maxE + pad };
}

/** Poligono chiuso: area tra baseline e profilo (per clip delle fasce superficie). */
function buildClipUnderProfilePath(
  coords: StoredCoord[],
  vMin: number,
  vMax: number,
  minElev: number,
  maxElev: number
): string {
  const baseY = CHART_H - PAD_B;
  const spanK = Math.max(1e-6, vMax - vMin);
  const spanE = Math.max(1, maxElev - minElev);
  const xFor = (km: number) => PAD_L + ((km - vMin) / spanK) * (CHART_W - PAD_L - PAD_R);
  const yFor = (e: number) =>
    PAD_T + (1 - (e - minElev) / spanE) * (CHART_H - PAD_T - PAD_B);
  const step = Math.max(1, Math.floor(coords.length / 900));
  const pts: [number, number][] = [];
  for (let i = 0; i < coords.length; i += step) {
    const c = coords[i];
    if (c[2] == null) continue;
    const k = c[3];
    if (k < vMin || k > vMax) continue;
    pts.push([xFor(k), yFor(c[2])]);
  }
  const xL = PAD_L;
  const xR = CHART_W - PAD_R;
  if (pts.length === 0) {
    return `M${xL},${baseY} L${xR},${baseY} Z`;
  }
  let d = `M${xL},${baseY}`;
  if (pts[0][0] > xL + 0.05) d += ` L${pts[0][0]},${baseY}`;
  d += ` L${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L${pts[i][0]},${pts[i][1]}`;
  }
  const pN = pts[pts.length - 1];
  d += ` L${pN[0]},${baseY}`;
  if (pN[0] < xR - 0.05) d += ` L${xR},${baseY}`;
  d += ` Z`;
  return d;
}

function surfaceForKm(
  bands: Array<{ km_start: number; km_end: number; surface: TrackSurfaceKind }>,
  km: number
): TrackSurfaceKind {
  for (const b of bands) {
    if (km >= b.km_start && km <= b.km_end) return b.surface;
  }
  return "unknown";
}

const SURFACE_STROKE: Record<TrackSurfaceKind, string> = {
  asphalt: "#94a3b8",
  gravel: "#eab308",
  single: "#22c55e",
  unknown: "#64748b",
};

/** Tratti del profilo con colore linea in base alla superficie al km. */
function buildProfileStrokeSegments(
  coords: StoredCoord[],
  vMin: number,
  vMax: number,
  minElev: number,
  maxElev: number,
  bands: Array<{ km_start: number; km_end: number; surface: TrackSurfaceKind }>
): { d: string; stroke: string }[] {
  const spanK = Math.max(1e-6, vMax - vMin);
  const spanE = Math.max(1, maxElev - minElev);
  const xFor = (km: number) => PAD_L + ((km - vMin) / spanK) * (CHART_W - PAD_L - PAD_R);
  const yFor = (e: number) =>
    PAD_T + (1 - (e - minElev) / spanE) * (CHART_H - PAD_T - PAD_B);
  const step = Math.max(1, Math.floor(coords.length / 900));

  const out: { d: string; stroke: string }[] = [];
  let stroke: string | null = null;
  let d = "";

  for (let i = 0; i < coords.length; i += step) {
    const c = coords[i];
    if (c[2] == null) continue;
    const k = c[3];
    if (k < vMin || k > vMax) continue;
    const x = xFor(k);
    const y = yFor(c[2]);
    const s = SURFACE_STROKE[surfaceForKm(bands, k)];
    if (stroke == null) {
      stroke = s;
      d = `M${x.toFixed(1)},${y.toFixed(1)}`;
    } else if (s !== stroke) {
      out.push({ d, stroke });
      stroke = s;
      d = `M${x.toFixed(1)},${y.toFixed(1)}`;
    } else {
      d += ` L${x.toFixed(1)},${y.toFixed(1)}`;
    }
  }
  if (stroke != null && d) out.push({ d, stroke });
  return out;
}

export default function ElevationChart({
  coords,
  sections,
  checkpoints,
  atKm,
  hoverKm = null,
  pinAKm = null,
  pinBKm = null,
  onHoverKm,
  onPinKm,
  onPinRange,
  raceItems = [],
  surfaceBands = [],
  hoverTerrainLabel = null,
  elevProfileGainScale = 1,
  elevProfileLossScale = 1,
  zoomKmLo = null,
  zoomKmHi = null,
  wrapperClassName = "",
}: ElevationChartProps) {
  const surfUid = useId().replace(/:/g, "");
  const geom = useMemo(() => computeGeom(coords), [coords]);
  const dragStartKmRef = useRef<number | null>(null);

  const hoverElev = useMemo(() => {
    if (hoverKm == null) return null;
    return coordAtKm(coords, hoverKm)?.elev ?? null;
  }, [hoverKm, coords]);

  const measurement = useMemo(() => {
    if (pinAKm == null) return null;
    const other = pinBKm ?? hoverKm;
    if (other == null) return null;
    return measureBetween(coords, pinAKm, other, {
      profileGainScale: elevProfileGainScale,
      profileLossScale: elevProfileLossScale,
    });
  }, [pinAKm, pinBKm, hoverKm, coords, elevProfileGainScale, elevProfileLossScale]);

  const zoomed = useMemo(() => {
    if (!geom) return null;
    const { totalKm } = geom;
    const hasZoom =
      zoomKmLo != null &&
      zoomKmHi != null &&
      Number.isFinite(zoomKmLo) &&
      Number.isFinite(zoomKmHi) &&
      zoomKmHi > zoomKmLo + 1e-3;
    if (!hasZoom) {
      const { minElev, maxElev } = geom;
      const underClip = buildClipUnderProfilePath(coords, 0, totalKm, minElev, maxElev);
      return {
        vMin: 0,
        vMax: totalKm,
        minElev,
        maxElev,
        underClip,
      };
    }
    const { vMin, vMax } = zoomPadKm(zoomKmLo, zoomKmHi, totalKm);
    const { minElev, maxElev } = elevRangeInWindow(coords, vMin, vMax);
    const underClip = buildClipUnderProfilePath(coords, vMin, vMax, minElev, maxElev);
    return { vMin, vMax, minElev, maxElev, underClip };
  }, [geom, coords, zoomKmLo, zoomKmHi]);

  const profileStrokes = useMemo(() => {
    if (!geom || !zoomed) return [] as { d: string; stroke: string }[];
    const { vMin, vMax, minElev, maxElev } = zoomed;
    return buildProfileStrokeSegments(coords, vMin, vMax, minElev, maxElev, surfaceBands);
  }, [geom, zoomed, coords, surfaceBands]);

  if (!geom || !zoomed) return null;
  const { totalKm } = geom;
  const { vMin, vMax, minElev, maxElev, underClip } = zoomed;

  const xForKm = (km: number) => {
    const span = Math.max(1e-6, vMax - vMin);
    return PAD_L + ((km - vMin) / span) * (CHART_W - PAD_L - PAD_R);
  };
  const yForElev = (e: number) =>
    PAD_T + (1 - (e - minElev) / Math.max(1, maxElev - minElev)) * (CHART_H - PAD_T - PAD_B);

  const kmFromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    const { x } = clientToViewBox(e.clientX, e.clientY, e.currentTarget, CHART_W, CHART_H);
    const frac = Math.max(0, Math.min(1, (x - PAD_L) / (CHART_W - PAD_L - PAD_R)));
    return vMin + frac * (vMax - vMin);
  };

  const pinAX = pinAKm != null ? xForKm(pinAKm) : null;
  const pinBX = pinBKm != null ? xForKm(pinBKm) : null;
  const bandBKm = pinBKm ?? (pinAKm != null ? hoverKm : null);
  const bandBX = bandBKm != null ? xForKm(bandBKm) : null;
  const bandStartX = pinAX != null && bandBX != null ? Math.min(pinAX, bandBX) : null;
  const bandEndX = pinAX != null && bandBX != null ? Math.max(pinAX, bandBX) : null;

  const kmLabel0 = vMin <= 0.05 ? "0 km" : `${vMin.toFixed(1)} km`;
  const kmLabel1 = vMax >= totalKm - 0.05 ? `${totalKm.toFixed(0)} km` : `${vMax.toFixed(1)} km`;

  const baseY = CHART_H - PAD_B;

  return (
    <div className={`hmr-panel relative min-h-[56px] overflow-hidden py-1 ${wrapperClassName}`.trim()}>
      <div className="mx-auto h-full min-h-[5rem] w-full">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="block h-full min-h-[5rem] w-full"
          preserveAspectRatio="xMidYMid meet"
          style={{ touchAction: "none", cursor: onPinKm || onPinRange ? "crosshair" : "default" }}
          onPointerMove={(e) => {
            const km = kmFromEvent(e);
            onHoverKm?.(km);
          }}
          onPointerLeave={() => {
            onHoverKm?.(null);
          }}
          onPointerDown={(e) => {
            if (!onPinKm && !onPinRange) return;
            e.preventDefault();
            dragStartKmRef.current = kmFromEvent(e);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            const start = dragStartKmRef.current;
            dragStartKmRef.current = null;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
            if (start == null) return;
            const end = kmFromEvent(e);
            const span = Math.abs(end - start);
            if (onPinRange && span > 0.12) {
              onPinRange(Math.min(start, end), Math.max(start, end));
            } else if (onPinKm) {
              onPinKm(end);
            }
          }}
          onPointerCancel={(e) => {
            dragStartKmRef.current = null;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          }}
        >
          <defs>
            <clipPath id={`${surfUid}-under-elev`}>
              <path d={underClip} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${surfUid}-under-elev)`}>
            {sections
              .filter((s) => s.severity === "hard" || s.severity === "warn")
              .map((s) => {
              const color = s.severity === "hard" ? "#f87171" : "#fbbf24";
              const opacity = s.severity === "hard" ? 0.4 : 0.3;
              const x0 = Math.max(PAD_L, xForKm(s.km_start));
              const x1 = Math.min(CHART_W - PAD_R, xForKm(s.km_end));
              const w = x1 - x0;
              if (w <= 0) return null;
              return (
                <rect
                  key={s.id}
                  x={x0}
                  y={PAD_T}
                  width={Math.max(0.5, w)}
                  height={CHART_H - PAD_T - PAD_B}
                  fill={color}
                  opacity={opacity}
                />
              );
            })}
          </g>
          {raceItems.map((it) => {
            const x0 = Math.max(PAD_L, xForKm(Math.min(it.km_start, it.km_end)));
            const x1 = Math.min(CHART_W - PAD_R, xForKm(Math.max(it.km_start, it.km_end)));
            const w = Math.max(0.5, x1 - x0);
            const fill =
              it.kind === "night_avoid"
                ? "#a855f7"
                : it.kind === "sleep"
                  ? "#4ade80"
                  : it.kind === "stage"
                    ? "#38bdf8"
                    : it.kind === "time"
                      ? "#fbbf24"
                      : "#64748b";
            const isPoint = Math.abs(it.km_end - it.km_start) < 0.05;
            if (isPoint) {
              const cx = xForKm(it.km_start);
              if (cx < PAD_L || cx > CHART_W - PAD_R) return null;
              return (
                <circle
                  key={it.id}
                  cx={cx}
                  cy={(PAD_T + CHART_H - PAD_B) / 2}
                  r={3.5}
                  fill={fill}
                  opacity={0.85}
                  stroke="#0b1221"
                  strokeWidth={0.8}
                />
              );
            }
            return (
              <rect
                key={it.id}
                x={x0}
                y={PAD_T + 2}
                width={w}
                height={CHART_H - PAD_T - PAD_B - 4}
                fill={fill}
                opacity={it.kind === "night_avoid" ? 0.28 : 0.16}
              />
            );
          })}
          {bandStartX != null && bandEndX != null && (
            <rect
              x={bandStartX}
              y={PAD_T}
              width={Math.max(0.5, bandEndX - bandStartX)}
              height={CHART_H - PAD_T - PAD_B}
              fill="#facc15"
              opacity={pinBKm == null ? 0.15 : 0.22}
            />
          )}
          {profileStrokes.map((seg, i) => (
            <path
              key={`prof-${i}`}
              d={seg.d}
              fill="none"
              stroke={seg.stroke}
              strokeWidth={1.85}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          <line
            x1={PAD_L}
            x2={CHART_W - PAD_R}
            y1={CHART_H - PAD_B}
            y2={CHART_H - PAD_B}
            stroke="#2b3558"
          />
          {checkpoints.map((cp) => {
            const x = xForKm(cp.along_km);
            if (x < PAD_L - 2 || x > CHART_W - PAD_R + 2) return null;
            const el = coordAtKm(coords, cp.along_km)?.elev;
            if (el == null) return null;
            const y = yForElev(el);
            return (
              <line
                key={cp.id}
                x1={x}
                x2={x}
                y1={y}
                y2={baseY}
                stroke={cp.kind === "finish" ? "#4ade80" : "#f87171"}
                strokeWidth={1.1}
                opacity={0.75}
              />
            );
          })}
          {atKm != null && atKm >= vMin && atKm <= vMax && (() => {
            const el = coordAtKm(coords, atKm)?.elev;
            if (el == null) return null;
            const x = xForKm(atKm);
            const y = yForElev(el);
            return (
              <line
                key="at"
                x1={x}
                x2={x}
                y1={y}
                y2={baseY}
                stroke="#38bdf8"
                strokeWidth={1.35}
                opacity={0.9}
              />
            );
          })()}
          {pinAX != null &&
            pinAKm != null &&
            (() => {
              const el = coordAtKm(coords, pinAKm)?.elev;
              if (el == null) return null;
              const y = yForElev(el);
              return (
                <line
                  key="pinA"
                  x1={pinAX}
                  x2={pinAX}
                  y1={y}
                  y2={baseY}
                  stroke="#4ade80"
                  strokeWidth={1.5}
                />
              );
            })()}
          {pinBX != null &&
            pinBKm != null &&
            (() => {
              const el = coordAtKm(coords, pinBKm)?.elev;
              if (el == null) return null;
              const y = yForElev(el);
              return (
                <line
                  key="pinB"
                  x1={pinBX}
                  x2={pinBX}
                  y1={y}
                  y2={baseY}
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                />
              );
            })()}
          {hoverKm != null &&
            hoverKm >= vMin &&
            hoverKm <= vMax &&
            hoverElev != null &&
            (() => {
              const x = xForKm(hoverKm);
              const y = yForElev(hoverElev);
              return (
                <line
                  key="hover-v"
                  x1={x}
                  x2={x}
                  y1={y}
                  y2={baseY}
                  stroke="#f6f8ff"
                  strokeWidth={1}
                  opacity={0.65}
                />
              );
            })()}
          {hoverKm != null && hoverElev != null && hoverKm >= vMin && hoverKm <= vMax && (
            <circle
              cx={xForKm(hoverKm)}
              cy={yForElev(hoverElev)}
              r={3.2}
              fill="#f6f8ff"
              stroke="#0b1221"
              strokeWidth={1}
            />
          )}
          <text x={PAD_L} y={CHART_H - 2} fontSize={10} fill="#9aa7c7">
            {kmLabel0}
          </text>
          <text x={CHART_W - PAD_R} y={CHART_H - 2} fontSize={10} fill="#9aa7c7" textAnchor="end">
            {kmLabel1}
          </text>
          <text x={2} y={PAD_T + 10} fontSize={10} fill="#9aa7c7">
            {Math.round(maxElev)}m
          </text>
          <text x={2} y={CHART_H - PAD_B} fontSize={10} fill="#9aa7c7">
            {Math.round(minElev)}m
          </text>
        </svg>
      </div>
      <ChartTooltip
        hoverKm={hoverKm}
        hoverElev={hoverElev}
        pinAKm={pinAKm}
        pinBKm={pinBKm}
        measurement={measurement}
        hoverTerrainLabel={hoverTerrainLabel}
      />
    </div>
  );
}

function ChartTooltip({
  hoverKm,
  hoverElev,
  pinAKm,
  pinBKm,
  measurement,
  hoverTerrainLabel,
}: {
  hoverKm: number | null;
  hoverElev: number | null;
  pinAKm: number | null;
  pinBKm: number | null;
  measurement: {
    distKm: number;
    gainM: number;
    lossM: number;
    elevA: number | null;
    elevB: number | null;
  } | null;
  hoverTerrainLabel?: string | null;
}) {
  const hasAny = hoverKm != null || pinAKm != null;
  if (!hasAny) return null;
  const showMeasure = measurement != null && pinAKm != null;
  return (
    <div className="pointer-events-none absolute right-2 top-1 rounded-md bg-black/70 px-2 py-1 text-[10px] leading-snug text-white">
      {hoverKm != null && (
        <div>
          km {hoverKm.toFixed(1)}
          {hoverElev != null ? ` · ${Math.round(hoverElev)} m` : ""}
        </div>
      )}
      {hoverKm != null && hoverTerrainLabel && (
        <div className="mt-0.5 text-[10px] text-emerald-200/95">Terreno: {hoverTerrainLabel}</div>
      )}
      {showMeasure && (
        <div className="mt-0.5 text-[10px] text-yellow-200">
          {pinBKm == null ? "A→cursore" : "A→B"} · Δ{measurement!.distKm.toFixed(2)} km
          {" · "}D+{Math.round(measurement!.gainM)} · D-{Math.round(measurement!.lossM)}
        </div>
      )}
    </div>
  );
}

function computeGeom(coords: StoredCoord[]): {
  minElev: number;
  maxElev: number;
  totalKm: number;
} | null {
  if (coords.length < 2) return null;
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (const c of coords) {
    if (c[2] != null) {
      if (c[2] < minElev) minElev = c[2];
      if (c[2] > maxElev) maxElev = c[2];
    }
  }
  if (!Number.isFinite(minElev) || !Number.isFinite(maxElev)) {
    minElev = 0;
    maxElev = 1;
  }
  const totalKm = coords[coords.length - 1][3];
  return { minElev, maxElev, totalKm };
}
