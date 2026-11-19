"use client";

import { useEffect, useMemo, useState } from "react";
import type { RegionBulletin } from "@/lib/avalanche-caaml";
import { demSamplerForBbox } from "@/lib/dem-sample";
import type { RouteColoredSegment } from "@/lib/ors-route-tech";
import {
  analyzeTrack,
  ASPECT_IT,
  ASPECT_ORDER,
  overallRisk,
  parseBandElevation,
  RISK_COLORS,
  RISK_LABELS,
  riskSections,
  SLOPE_CLASSES,
  summarizeTerrain,
  type BulletinInput,
  type RiskSection,
  type TerrainPoint,
} from "@/lib/ski-terrain";

type Props = {
  ascentCoords: [number, number][] | null;
  descentCoords: [number, number][] | null;
  /** Tratti colorati per rischio da mostrare sulla mappa (null = colori normali). */
  onRiskSegments: (segments: RouteColoredSegment[] | null) => void;
};

function toBulletinInput(b: RegionBulletin): BulletinInput {
  return {
    maxDanger: b.maxDanger,
    ratings: b.ratings.map((r) => ({
      level: r.level,
      lower: parseBandElevation(r.elevation.lower),
      upper: parseBandElevation(r.elevation.upper),
      aspects: r.aspects,
    })),
    problems: b.problems.map((p) => ({
      aspects: p.aspects,
      lower: parseBandElevation(p.elevation.lower),
      upper: parseBandElevation(p.elevation.upper),
    })),
  };
}

/** Rosa delle esposizioni: spicchio = km sul versante; pieno = tratti ≥ 30°. */
function AspectRose({ all, steep }: { all: Record<string, number>; steep: Record<string, number> }) {
  const max = Math.max(0.05, ...Object.values(all));
  const R = 52;
  const C = 64;
  const wedge = (i: number, frac: number) => {
    const r = Math.max(2, frac * R);
    const a0 = ((i * 45 - 22.5 - 90) * Math.PI) / 180;
    const a1 = ((i * 45 + 22.5 - 90) * Math.PI) / 180;
    return `M${C},${C} L${C + r * Math.cos(a0)},${C + r * Math.sin(a0)} A${r},${r} 0 0 1 ${C + r * Math.cos(a1)},${C + r * Math.sin(a1)} Z`;
  };
  return (
    <svg viewBox="0 0 128 128" className="h-32 w-32 shrink-0" aria-label="Rosa delle esposizioni">
      {[0.33, 0.66, 1].map((f) => (
        <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="var(--hmr-border)" />
      ))}
      {ASPECT_ORDER.map((a, i) => (
        <g key={a}>
          <path d={wedge(i, all[a] / max)} fill="#60a5fa" opacity={0.35} />
          <path d={wedge(i, steep[a] / max)} fill="#ef4444" opacity={0.8} />
          <text
            x={C + (R + 8) * Math.cos(((i * 45 - 90) * Math.PI) / 180)}
            y={C + (R + 8) * Math.sin(((i * 45 - 90) * Math.PI) / 180) + 3}
            fontSize={9}
            textAnchor="middle"
            fill="currentColor"
          >
            {ASPECT_IT[a]}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Terreno valanghivo lungo la traccia: pendenza ed esposizione dei versanti
 * dal DEM, incrociati col bollettino del giorno → rischio per tratto.
 */
export default function V2SkiTerrainPanel({ ascentCoords, descentCoords, onRiskSegments }: Props) {
  const [points, setPoints] = useState<{ ascent: TerrainPoint[]; descent: TerrainPoint[] } | null>(null);
  const [bulletin, setBulletin] = useState<{ input: BulletinInput; label: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [colorOn, setColorOn] = useState(false);

  const key = useMemo(() => JSON.stringify([ascentCoords?.length, ascentCoords?.[0], descentCoords?.length, descentCoords?.at(-1)]), [ascentCoords, descentCoords]);

  useEffect(() => {
    const all = [...(ascentCoords ?? []), ...(descentCoords ?? [])];
    if (all.length < 2) {
      setPoints(null);
      setStatus("idle");
      return;
    }
    let alive = true;
    setStatus("loading");
    (async () => {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of all) {
        w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
      }
      const pad = 0.003;
      const bbox = { west: w - pad, east: e + pad, south: s - pad, north: n + pad };
      const sampler = (await demSamplerForBbox(bbox, 13)) ?? (await demSamplerForBbox(bbox, 12));
      const start = all[0];
      const bul = await fetch(`/api/v2/ski/avalanche?lat=${start[1].toFixed(5)}&lng=${start[0].toFixed(5)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null) as { point?: { bulletin?: RegionBulletin | null; region?: { name: string } | null } } | null;
      if (!alive) return;
      if (!sampler) {
        setStatus("error");
        return;
      }
      setPoints({
        ascent: ascentCoords && ascentCoords.length >= 2 ? analyzeTrack(sampler, ascentCoords) : [],
        descent: descentCoords && descentCoords.length >= 2 ? analyzeTrack(sampler, descentCoords) : [],
      });
      const b = bul?.point?.bulletin;
      setBulletin(b ? { input: toBulletinInput(b), label: `${bul?.point?.region?.name ?? b.regionName} · grado max ${b.maxDanger ?? "—"}` } : null);
      setStatus("ready");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const summary = useMemo(() => (points ? summarizeTerrain([...points.ascent, ...points.descent]) : null), [points]);
  const sections = useMemo<{ ascent: RiskSection[]; descent: RiskSection[] } | null>(
    () => (points && bulletin ? { ascent: riskSections(bulletin.input, points.ascent), descent: riskSections(bulletin.input, points.descent) } : null),
    [points, bulletin],
  );
  const overall = sections ? overallRisk([...sections.ascent, ...sections.descent]) : null;

  useEffect(() => {
    if (!colorOn || !sections) {
      onRiskSegments(null);
      return;
    }
    onRiskSegments(
      [...sections.ascent, ...sections.descent].map((s) => ({ coordinates: s.coordinates, color: RISK_COLORS[s.level], surface: "unknown" })),
    );
  }, [colorOn, sections, onRiskSegments]);

  if (status === "idle") return null;
  if (status === "loading") return <p className="text-[11.5px] text-[color:var(--hmr-muted)]">Analizzo i versanti lungo la traccia…</p>;
  if (status === "error" || !summary) return <p className="text-[11.5px] text-[color:var(--hmr-muted)]">Analisi del terreno non disponibile (DEM non raggiungibile).</p>;

  const total = summary.slope_km.reduce((a, b) => a + b, 0) || 1;
  const flagged = sections
    ? [
        ...sections.ascent.map((s) => ({ ...s, leg: "Salita" })),
        ...sections.descent.map((s) => ({ ...s, leg: "Discesa" })),
      ].filter((s) => s.level !== "low" && s.kmEnd - s.kmStart >= 0.03)
    : [];

  return (
    <section className="space-y-2.5 rounded-lg border border-[color:var(--hmr-border)] p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Terreno valanghivo</p>
        {overall ? (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: RISK_COLORS[overall] }}>
            Rischio {RISK_LABELS[overall]}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <AspectRose all={summary.aspect_km} steep={summary.aspect_km_steep} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-[11px] text-[color:var(--hmr-muted)]">Pendenza dei versanti attraversati</div>
          <div className="flex h-3 overflow-hidden rounded-full">
            {SLOPE_CLASSES.map((c, i) => (
              <div key={c.label} style={{ width: `${(summary.slope_km[i] / total) * 100}%`, background: c.color }} title={c.label} />
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-x-2 text-[10.5px] text-[color:var(--hmr-muted)]">
            {SLOPE_CLASSES.map((c, i) => (
              <li key={c.label} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: c.color }} />
                {c.label}: {summary.slope_km[i].toFixed(2)} km
              </li>
            ))}
          </ul>
          <div className="text-[10.5px] text-[color:var(--hmr-muted)]">Max {summary.max_slope ?? "—"}° · rosso nella rosa = tratti ≥ 30°</div>
        </div>
      </div>

      {bulletin ? (
        <>
          <p className="text-[11px] text-[color:var(--hmr-muted)]">Bollettino: {bulletin.label}</p>
          {flagged.length ? (
            <ul className="space-y-0.5">
              {flagged.map((s, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: RISK_COLORS[s.level] }} />
                  {s.leg} km {s.kmStart.toFixed(2)}–{s.kmEnd.toFixed(2)} · versante fino a {Math.round(s.maxSlope)}° · rischio{" "}
                  {RISK_LABELS[s.level]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px]">Nessun tratto oltre la soglia con il bollettino di oggi.</p>
          )}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={colorOn} onChange={(e) => setColorOn(e.target.checked)} />
            Colora la traccia per rischio
          </label>
        </>
      ) : (
        <p className="text-[11px] text-[color:var(--hmr-muted)]">Nessun bollettino per la zona oggi: mostro solo pendenze ed esposizioni.</p>
      )}
      <p className="text-[10px] leading-snug text-[color:var(--hmr-faint)]">
        Calcolo indicativo (DEM ~15 m, metodo di riduzione semplificato sul bollettino del punto di partenza). Non
        sostituisce la valutazione sul posto né la formazione.
      </p>
    </section>
  );
}
