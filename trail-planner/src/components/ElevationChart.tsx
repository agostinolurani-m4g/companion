"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePlanner } from "@/context/PlannerProvider";
import { elevationGainLossM } from "@/lib/elevation";

type Props = {
  /** Distanza dall’inizio percorso (km) sotto il cursore sulla mappa. */
  hoverKm?: number | null;
  /** Distanza dal cursore alla polilinea (km), anche se sopra soglia snap. */
  hoverDistKm?: number;
  /** Mostra solo questo tratto del profilo (km assoluti dall’inizio). */
  vizRange?: { startKm: number; endKm: number } | null;
  /** Tappe da segnare sul grafico (km lungo la traccia). */
  stopMarkers?: { id: string; name: string; km: number }[];
};

function segmentGradePct(
  a: { km: number; m: number },
  b: { km: number; m: number },
  unit: "km" | "mi"
): number {
  const dDisplay = Math.abs(b.km - a.km);
  if (dDisplay < 1e-12) return 0;
  const runM = unit === "mi" ? dDisplay * 1609.34 : dDisplay * 1000;
  const riseM = b.m - a.m;
  return (riseM / runM) * 100;
}

function slopeStroke(gradePct: number): string {
  const g = Math.abs(gradePct);
  if (g < 5) return "#22c55e";
  if (g < 12) return "#eab308";
  if (g < 22) return "#f97316";
  return "#ef4444";
}

function gradeAtHover(
  rows: { km: number; m: number }[],
  x: number,
  unit: "km" | "mi"
): number | null {
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const lo = Math.min(a.km, b.km);
    const hi = Math.max(a.km, b.km);
    if (x + 1e-9 >= lo && x <= hi + 1e-9) {
      return segmentGradePct(a, b, unit);
    }
  }
  return null;
}

export function ElevationChart({
  hoverKm = null,
  hoverDistKm = Number.POSITIVE_INFINITY,
  vizRange = null,
  stopMarkers = [],
}: Props) {
  const { displayLine, profile } = usePlanner();
  const [data, setData] = useState<{ km: number; m: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!displayLine?.geometry?.coordinates?.length) {
      setData([]);
      setLoading(false);
      return;
    }
    const coords = displayLine.geometry.coordinates;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const res = await fetch("/api/elevation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates: coords }),
        });
        const j = (await res.json()) as {
          distanceKm?: number[];
          elevationM?: number[];
          error?: string;
        };
        if (!res.ok) {
          setErr(j.error ?? "Elevazione non disponibile");
          setData([]);
          return;
        }
        setErr(null);
        const km = j.distanceKm ?? [];
        const m = j.elevationM ?? [];
        setData(km.map((k, i) => ({ km: k, m: m[i] ?? 0 })));
      } catch {
        setErr("Errore rete");
        setData([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [displayLine]);

  const unit = profile?.units === "mi" ? "mi" : "km";
  const conv = unit === "mi" ? 0.621371 : 1;

  const chartRows = useMemo(() => {
    let rows = data.map((d) => ({ ...d, km: d.km * conv }));
    if (vizRange && rows.length) {
      const lo = Math.min(vizRange.startKm, vizRange.endKm) * conv;
      const hi = Math.max(vizRange.startKm, vizRange.endKm) * conv;
      rows = rows.filter((d) => d.km >= lo - 1e-6 && d.km <= hi + 1e-6);
    }
    return rows;
  }, [data, vizRange, conv]);

  const slopeSegments = useMemo(() => {
    if (chartRows.length < 2) return [];
    const segs: { p0: { km: number; m: number }; p1: { km: number; m: number }; color: string }[] = [];
    for (let i = 0; i < chartRows.length - 1; i++) {
      const a = chartRows[i];
      const b = chartRows[i + 1];
      const g = segmentGradePct(a, b, unit);
      segs.push({
        p0: a,
        p1: b,
        color: slopeStroke(g),
      });
    }
    return segs;
  }, [chartRows, unit]);

  /** Distanza e dislivello del profilo corrente (intero o finestra). */
  const routeTotals = useMemo(() => {
    const lastKmFull = data.length ? data[data.length - 1].km * conv : 0;
    const lastKm = chartRows.length ? chartRows[chartRows.length - 1].km : lastKmFull;
    const gainLossData = chartRows.length >= 2 ? chartRows : data.map((d) => ({ ...d, km: d.km * conv }));
    const { gain, loss } =
      gainLossData.length >= 2 ? elevationGainLossM(gainLossData.map((d) => d.m)) : { gain: 0, loss: 0 };
    return { lastKm, gain, loss };
  }, [data, chartRows, conv]);

  /** Asse X del grafico: km o mi a seconda dell’unità. */
  const hoverDisplay = hoverKm != null ? hoverKm * conv : null;
  const vizLo = vizRange ? Math.min(vizRange.startKm, vizRange.endKm) * conv : null;
  const vizHi = vizRange ? Math.max(vizRange.startKm, vizRange.endKm) * conv : null;
  const showHoverLine =
    hoverDisplay != null &&
    (vizRange == null ||
      (hoverKm! >= Math.min(vizRange.startKm, vizRange.endKm) - 1e-6 &&
        hoverKm! <= Math.max(vizRange.startKm, vizRange.endKm) + 1e-6));

  const hoverElev =
    displayLine &&
    showHoverLine &&
    chartRows.length >= 1 &&
    hoverDisplay != null
      ? (() => {
          const x = hoverDisplay;
          let best = chartRows[0];
          let bd = Math.abs(chartRows[0].km - x);
          for (const r of chartRows) {
            const d = Math.abs(r.km - x);
            if (d < bd) {
              bd = d;
              best = r;
            }
          }
          return best.m;
        })()
      : null;

  const hoverGradePct =
    showHoverLine && hoverDisplay != null && chartRows.length >= 2
      ? gradeAtHover(chartRows, hoverDisplay, unit)
      : null;

  /** Da inizio traccia (o inizio tratto visualizzato) fino al cursore. */
  const partialToHover = useMemo(() => {
    if (!displayLine || !showHoverLine || hoverKm == null || chartRows.length < 1) return null;
    const loKm = vizRange != null ? Math.min(vizRange.startKm, vizRange.endKm) : 0;
    const hiKm = hoverKm;
    if (hiKm <= loKm + 1e-9) {
      return { dist: 0, gain: 0, loss: 0 };
    }
    const loD = loKm * conv;
    const hiD = hiKm * conv;
    const slice = chartRows.filter((d) => d.km >= loD - 1e-6 && d.km <= hiD + 1e-6);
    if (slice.length < 2) {
      return { dist: hiD - loD, gain: 0, loss: 0 };
    }
    const { gain, loss } = elevationGainLossM(slice.map((d) => d.m));
    return { dist: hiD - loD, gain, loss };
  }, [displayLine, showHoverLine, hoverKm, chartRows, vizRange, conv]);

  /** Sempre mostrato: tratto fino al cursore se sei sulla traccia, altrimenti totali del profilo. */
  const cumulativeLine = useMemo(() => {
    if (!chartRows.length) return null;
    if (showHoverLine && hoverKm != null && partialToHover) {
      return {
        mode: "partial" as const,
        label: vizRange ? "Nel tratto, da inizio finestra al cursore" : "Da inizio percorso al cursore",
        dist: partialToHover.dist,
        gain: partialToHover.gain,
        loss: partialToHover.loss,
      };
    }
    return {
      mode: "total" as const,
      label: vizRange ? "Totale del tratto visualizzato" : "Intero percorso",
      dist: routeTotals.lastKm,
      gain: routeTotals.gain,
      loss: routeTotals.loss,
    };
  }, [
    chartRows.length,
    showHoverLine,
    hoverKm,
    partialToHover,
    vizRange,
    routeTotals,
  ]);

  /** Dislivello residuo dal cursore alla fine del profilo mostrato. */
  const residualToEnd = useMemo(() => {
    if (!showHoverLine || hoverKm == null || chartRows.length < 2) return null;
    const loD = hoverKm * conv;
    const slice = chartRows.filter((d) => d.km >= loD - 1e-6);
    if (slice.length < 2) return null;
    const { gain, loss } = elevationGainLossM(slice.map((d) => d.m));
    return { gain, loss };
  }, [showHoverLine, hoverKm, chartRows, conv]);

  if (!displayLine) {
    return (
      <div className="h-36 rounded border border-zinc-700/50 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500">
        Profilo altimetrico: aggiungi tappe o importa GPX per una traccia.
      </div>
    );
  }

  if (loading && data.length === 0 && !err) {
    return (
      <div className="h-36 rounded border border-zinc-700/50 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500">
        Profilo altimetrico: caricamento quote da modello digitale del terreno…
      </div>
    );
  }

  const { lastKm, gain, loss } = routeTotals;
  const minEl = chartRows.length ? Math.min(...chartRows.map((d) => d.m)) : data.length ? Math.min(...data.map((d) => d.m)) : 0;
  const maxEl = chartRows.length ? Math.max(...chartRows.map((d) => d.m)) : data.length ? Math.max(...data.map((d) => d.m)) : 0;

  const farDistLabel =
    !showHoverLine && hoverDistKm < Number.POSITIVE_INFINITY && hoverDistKm >= 0
      ? hoverDistKm < 1
        ? `${Math.round(hoverDistKm * 1000)} m`
        : `${hoverDistKm.toFixed(2)} km`
      : null;

  const chartData =
    chartRows.length >= 2
      ? chartRows
      : chartRows.length === 1
        ? [chartRows[0], chartRows[0]]
        : [{ km: 0, m: 0 }];

  return (
    <div className="rounded border border-zinc-700/50 bg-zinc-900/30 px-1 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2 text-[10px] text-zinc-500">
        <span>
          Distanza: <strong className="text-zinc-300">{lastKm.toFixed(1)}</strong> {unit}
          {vizRange ? " (tratto)" : ""}
        </span>
        <span>
          Dislivello +: <strong className="text-emerald-400/90">{Math.round(gain)}</strong> m
        </span>
        <span>
          Dislivello −: <strong className="text-sky-400/90">{Math.round(loss)}</strong> m
        </span>
        <span>
          Quota min/max: {Math.round(minEl)} / {Math.round(maxEl)} m
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 px-2 pt-1 text-[10px] text-zinc-500">
        <span>
          Pendenza (colore):{" "}
          <span className="text-emerald-500">piano</span> → <span className="text-amber-400">medio</span> →{" "}
          <span className="text-orange-500">ripido</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 px-2 pt-0.5 text-[10px] text-zinc-500">
        {showHoverLine && hoverElev != null ? (
          <>
            <span className="text-amber-200/90">
              Vicino al percorso: ~{hoverDisplay!.toFixed(1)} {unit} · quota ~{Math.round(hoverElev)} m
            </span>
            {hoverGradePct != null ? (
              <span className="text-zinc-400">
                Pendenza ~<strong className="text-zinc-200">{hoverGradePct.toFixed(1)}</strong>%
              </span>
            ) : null}
            {residualToEnd ? (
              <span className="text-zinc-500">
                Residuo → fine: +{Math.round(residualToEnd.gain)} / −{Math.round(residualToEnd.loss)} m
              </span>
            ) : null}
          </>
        ) : farDistLabel ? (
          <span className="text-zinc-500">
            Lontano dalla traccia (~{farDistLabel}) — sopra i totali dell’itinerario.
          </span>
        ) : (
          <span className="text-zinc-600">Avvicina il cursore alla traccia per quota e pendenza locali.</span>
        )}
      </div>
      {cumulativeLine ? (
        <p className="px-2 pb-1 text-[10px] text-zinc-400">
          <span className="text-zinc-500">{cumulativeLine.label}</span>
          {cumulativeLine.mode === "total" && !showHoverLine ? (
            <span className="text-zinc-600"> — cursore non sulla traccia, mostriamo i totali</span>
          ) : null}
          :{" "}
          <strong className="text-zinc-200">{cumulativeLine.dist.toFixed(1)}</strong> {unit} · +{" "}
          <strong className="text-emerald-400/90">{Math.round(cumulativeLine.gain)}</strong> m / −{" "}
          <strong className="text-sky-400/90">{Math.round(cumulativeLine.loss)}</strong> m
        </p>
      ) : null}
      {err && <p className="px-2 text-xs text-amber-400">{err}</p>}
      <div className="mt-1 h-32 w-full min-w-0">
        <ResponsiveContainer width="100%" height={128}>
          <LineChart data={chartData}>
            <XAxis
              dataKey="km"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 10, fill: "#a1a1aa" }}
              label={{ value: unit, position: "insideBottom", offset: -2, fill: "#71717a" }}
            />
            <YAxis tick={{ fontSize: 10, fill: "#a1a1aa" }} width={36} unit="m" />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
              formatter={(v) => [`${Math.round(Number(v))} m`, "Quota"]}
              labelFormatter={(l) => `Distanza: ${Number(l).toFixed(1)} ${unit}`}
            />
            {slopeSegments.map((seg, i) => (
              <Line
                key={i}
                type="linear"
                data={[seg.p0, seg.p1]}
                dataKey="m"
                stroke={seg.color}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
                legendType="none"
              />
            ))}
            {showHoverLine && hoverDisplay != null ? (
              <ReferenceLine
                x={hoverDisplay}
                stroke="#fbbf24"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            ) : null}
            {stopMarkers.map((s) => {
              const x = s.km * conv;
              if (vizLo != null && vizHi != null && (x < vizLo || x > vizHi)) return null;
              return (
                <ReferenceLine
                  key={s.id}
                  x={x}
                  stroke="#a78bfa"
                  strokeOpacity={0.55}
                  strokeWidth={1}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
