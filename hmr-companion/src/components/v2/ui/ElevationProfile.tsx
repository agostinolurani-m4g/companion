"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StoredCoord } from "@/lib/track-coords";

type Props = {
  coords: StoredCoord[];
  hoverKm: number | null;
  onHoverKm: (km: number | null) => void;
  className?: string;
};

const PAD = { l: 44, r: 12, t: 10, b: 22 };

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Profilo altimetrico minimale: area grigia, linea scura, griglia leggera, cursore sincronizzato con la mappa. */
export default function ElevationProfile({ coords, hoverKm, onHoverKm, className = "" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 140 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(90, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => coords.filter((c) => c[2] != null) as [number, number, number, number][], [coords]);

  const geom = useMemo(() => {
    if (pts.length < 2) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) {
      if (p[2] < min) min = p[2];
      if (p[2] > max) max = p[2];
    }
    const span = Math.max(50, max - min);
    const yStep = niceStep(span, 3);
    const lo = Math.floor((min - span * 0.08) / yStep) * yStep;
    const hi = Math.ceil((max + span * 0.05) / yStep) * yStep;
    const total = pts[pts.length - 1]![3] || 1;
    const xStep = niceStep(total, Math.max(3, Math.round(size.w / 110)));
    const iw = size.w - PAD.l - PAD.r;
    const ih = size.h - PAD.t - PAD.b;
    const x = (km: number) => PAD.l + (km / total) * iw;
    const y = (m: number) => PAD.t + (1 - (m - lo) / (hi - lo)) * ih;
    let line = "";
    pts.forEach((p, i) => {
      line += `${i === 0 ? "M" : "L"}${x(p[3]).toFixed(1)},${y(p[2]).toFixed(1)}`;
    });
    const area = `${line}L${x(total).toFixed(1)},${y(lo).toFixed(1)}L${x(0).toFixed(1)},${y(lo).toFixed(1)}Z`;
    const yTicks: number[] = [];
    for (let v = lo; v <= hi + 1e-6; v += yStep) yTicks.push(v);
    const xTicks: number[] = [];
    for (let v = 0; v <= total + 1e-6; v += xStep) xTicks.push(v);
    return { line, area, yTicks, xTicks, x, y, total, lo, min, max };
  }, [pts, size]);

  const hover = useMemo(() => {
    if (!geom || hoverKm == null) return null;
    let best = pts[0]!;
    for (const p of pts) {
      if (Math.abs(p[3] - hoverKm) < Math.abs(best[3] - hoverKm)) best = p;
    }
    return { km: best[3], ele: best[2], x: geom.x(best[3]), y: geom.y(best[2]) };
  }, [geom, hoverKm, pts]);

  const onMove = (clientX: number) => {
    if (!geom || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const px = clientX - r.left;
    const km = ((px - PAD.l) / (size.w - PAD.l - PAD.r)) * geom.total;
    onHoverKm(Math.max(0, Math.min(geom.total, km)));
  };

  return (
    <div
      ref={wrapRef}
      className={`relative h-full w-full select-none ${className}`}
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseLeave={() => onHoverKm(null)}
      onTouchMove={(e) => e.touches[0] && onMove(e.touches[0].clientX)}
      onTouchEnd={() => onHoverKm(null)}
    >
      {geom ? (
        <svg width={size.w} height={size.h} className="block" aria-label="Profilo altimetrico">
          {geom.yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD.l} x2={size.w - PAD.r} y1={geom.y(v)} y2={geom.y(v)} style={{ stroke: "var(--hmr-border)" }} />
              <text x={PAD.l - 6} y={geom.y(v) + 3.5} fontSize={10} style={{ fill: "var(--hmr-faint)" }} textAnchor="end">
                {Math.round(v)}
              </text>
            </g>
          ))}
          {geom.xTicks.map((v) => (
            <text key={`x${v}`} x={geom.x(v)} y={size.h - 6} fontSize={10} style={{ fill: "var(--hmr-faint)" }} textAnchor="middle">
              {v % 1 === 0 ? v : v.toFixed(1)} km
            </text>
          ))}
          <defs>
            <linearGradient id="v2-prof-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--hmr-accent)", stopOpacity: 0.32 }} />
              <stop offset="1" style={{ stopColor: "var(--hmr-accent)", stopOpacity: 0.03 }} />
            </linearGradient>
          </defs>
          <path d={geom.area} fill="url(#v2-prof-fill)" />
          <path d={geom.line} fill="none" style={{ stroke: "var(--hmr-accent)" }} strokeWidth={1.6} strokeLinejoin="round" />
          {hover ? (
            <g>
              <line x1={hover.x} x2={hover.x} y1={PAD.t} y2={size.h - PAD.b} style={{ stroke: "var(--hmr-accent-2)" }} strokeWidth={1} />
              <circle cx={hover.x} cy={hover.y} r={4} style={{ fill: "var(--hmr-surface)", stroke: "var(--hmr-accent-2)" }} strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : null}
      {hover ? (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] px-2 py-1 text-[11.5px] font-medium tabular-nums shadow-sm"
          style={{ left: Math.min(Math.max(hover.x - 50, 4), size.w - 110) }}
        >
          {hover.km.toFixed(1)} km · {Math.round(hover.ele)} m
        </div>
      ) : null}
    </div>
  );
}
