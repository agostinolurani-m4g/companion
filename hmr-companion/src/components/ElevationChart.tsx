"use client";

import { useMemo } from "react";
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
  /** Annotazioni del piano gara attivo (sopra le sezioni, sotto la banda misura) */
  raceItems?: ElevationRaceItem[];
  /** Fasce km per superficie (da snapshot OSM); sotto sezioni “toughest”. */
  surfaceBands?: Array<{ km_start: number; km_end: number; surface: TrackSurfaceKind }>;
  /** Testo terreno al km del cursore (tooltip). */
  hoverTerrainLabel?: string | null;
  /** Da DB (ingest): D+/D- segmento proporzionali al GPX grezzo ITRA. */
  elevProfileGainScale?: number;
  elevProfileLossScale?: number;
};

const CHART_W = 720;
const CHART_H = 96;
const PAD_L = 32;
const PAD_R = 12;
const PAD_T = 6;
const PAD_B = 14;

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
  raceItems = [],
  surfaceBands = [],
  hoverTerrainLabel = null,
  elevProfileGainScale = 1,
  elevProfileLossScale = 1,
}: ElevationChartProps) {
  const geom = useMemo(() => computeGeom(coords), [coords]);

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

  if (!geom) return null;
  const { minElev, maxElev, totalKm, path } = geom;

  const xForKm = (km: number) =>
    PAD_L + (km / totalKm) * (CHART_W - PAD_L - PAD_R);
  const yForElev = (e: number) =>
    PAD_T + (1 - (e - minElev) / Math.max(1, maxElev - minElev)) * (CHART_H - PAD_T - PAD_B);

  const kmFromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    const { x } = clientToViewBox(e.clientX, e.clientY, e.currentTarget, CHART_W, CHART_H);
    const frac = Math.max(0, Math.min(1, (x - PAD_L) / (CHART_W - PAD_L - PAD_R)));
    return frac * totalKm;
  };

  const pinAX = pinAKm != null ? xForKm(pinAKm) : null;
  const pinBX = pinBKm != null ? xForKm(pinBKm) : null;
  const bandBKm = pinBKm ?? (pinAKm != null ? hoverKm : null);
  const bandBX = bandBKm != null ? xForKm(bandBKm) : null;
  const bandStartX =
    pinAX != null && bandBX != null ? Math.min(pinAX, bandBX) : null;
  const bandEndX =
    pinAX != null && bandBX != null ? Math.max(pinAX, bandBX) : null;

  return (
    <div className="hmr-panel relative min-h-[44px] overflow-hidden py-1.5">
      <div className="mx-auto w-full max-h-[min(28vw,6.25rem)] min-h-[3rem]">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="block h-full w-full max-h-[min(28vw,6.25rem)] min-h-[3rem]"
          preserveAspectRatio="xMidYMid meet"
          style={{ touchAction: "none", cursor: "crosshair" }}
          onPointerMove={(e) => {
            const km = kmFromEvent(e);
            onHoverKm?.(km);
          }}
          onPointerLeave={() => {
            onHoverKm?.(null);
          }}
          onPointerDown={(e) => {
            if (!onPinKm) return;
            e.preventDefault();
            const km = kmFromEvent(e);
            onPinKm(km);
          }}
        >
          {surfaceBands.map((b, i) => {
            const color =
              b.surface === "asphalt"
                ? "#94a3b8"
                : b.surface === "gravel"
                  ? "#d97706"
                  : b.surface === "single"
                    ? "#10b981"
                    : "#475569";
            const x = xForKm(b.km_start);
            const w = xForKm(b.km_end) - x;
            return (
              <rect
                key={`surf-${i}-${b.km_start}`}
                x={x}
                y={PAD_T}
                width={Math.max(0.5, w)}
                height={CHART_H - PAD_T - PAD_B}
                fill={color}
                opacity={b.surface === "unknown" ? 0.06 : 0.12}
              />
            );
          })}
          {sections.map((s) => {
            const color =
              s.severity === "hard" ? "#f87171" : s.severity === "warn" ? "#fbbf24" : "#38bdf8";
            const x = xForKm(s.km_start);
            const w = xForKm(s.km_end) - x;
            return (
              <rect
                key={s.id}
                x={x}
                y={PAD_T}
                width={Math.max(0.5, w)}
                height={CHART_H - PAD_T - PAD_B}
                fill={color}
                opacity={0.18}
              />
            );
          })}
          {raceItems.map((it) => {
            const x0 = xForKm(Math.min(it.km_start, it.km_end));
            const x1 = xForKm(Math.max(it.km_start, it.km_end));
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
          <path
            d={path}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={1.7}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <line
            x1={PAD_L}
            x2={CHART_W - PAD_R}
            y1={CHART_H - PAD_B}
            y2={CHART_H - PAD_B}
            stroke="#2b3558"
          />
          {checkpoints.map((cp) => {
            const x = xForKm(cp.along_km);
            return (
              <g key={cp.id}>
                <line
                  x1={x}
                  x2={x}
                  y1={PAD_T}
                  y2={CHART_H - PAD_B}
                  stroke={cp.kind === "finish" ? "#4ade80" : "#f87171"}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  opacity={0.6}
                />
              </g>
            );
          })}
          {atKm != null && (
            <line
              x1={xForKm(atKm)}
              x2={xForKm(atKm)}
              y1={PAD_T}
              y2={CHART_H - PAD_B}
              stroke="#38bdf8"
              strokeWidth={1.4}
            />
          )}
          {pinAX != null && (
            <line
              x1={pinAX}
              x2={pinAX}
              y1={PAD_T}
              y2={CHART_H - PAD_B}
              stroke="#4ade80"
              strokeWidth={1.6}
            />
          )}
          {pinBX != null && (
            <line
              x1={pinBX}
              x2={pinBX}
              y1={PAD_T}
              y2={CHART_H - PAD_B}
              stroke="#f59e0b"
              strokeWidth={1.6}
            />
          )}
          {hoverKm != null && (
            <line
              x1={xForKm(hoverKm)}
              x2={xForKm(hoverKm)}
              y1={PAD_T}
              y2={CHART_H - PAD_B}
              stroke="#f6f8ff"
              strokeWidth={1}
              opacity={0.75}
            />
          )}
          {hoverKm != null && hoverElev != null && (
            <circle
              cx={xForKm(hoverKm)}
              cy={yForElev(hoverElev)}
              r={3.2}
              fill="#f6f8ff"
              stroke="#0b1221"
              strokeWidth={1}
            />
          )}
          <text x={PAD_L} y={CHART_H - 3} fontSize={10} fill="#9aa7c7">
            0 km
          </text>
          <text
            x={CHART_W - PAD_R}
            y={CHART_H - 3}
            fontSize={10}
            fill="#9aa7c7"
            textAnchor="end"
          >
            {totalKm.toFixed(0)} km
          </text>
          <text x={2} y={PAD_T + 9} fontSize={10} fill="#9aa7c7">
            {Math.round(maxElev)}m
          </text>
          <text x={2} y={CHART_H - PAD_B - 1} fontSize={10} fill="#9aa7c7">
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
  path: string;
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
  const step = Math.max(1, Math.floor(coords.length / 1200));
  const xForKm = (km: number) =>
    PAD_L + (km / totalKm) * (CHART_W - PAD_L - PAD_R);
  const yForElev = (e: number) =>
    PAD_T + (1 - (e - minElev) / Math.max(1, maxElev - minElev)) * (CHART_H - PAD_T - PAD_B);
  let path = "";
  let started = false;
  for (let i = 0; i < coords.length; i += step) {
    const c = coords[i];
    if (c[2] == null) continue;
    const x = xForKm(c[3]);
    const y = yForElev(c[2]);
    path += `${started ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    started = true;
  }
  return { path, minElev, maxElev, totalKm };
}
