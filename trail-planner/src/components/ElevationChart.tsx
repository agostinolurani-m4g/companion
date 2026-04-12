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
  /** Mostra solo questo tratto del profilo (km assoluti dall’inizio). */
  vizRange?: { startKm: number; endKm: number } | null;
  /** Tappe da segnare sul grafico (km lungo la traccia). */
  stopMarkers?: { id: string; name: string; km: number }[];
};

export function ElevationChart({ hoverKm = null, vizRange = null, stopMarkers = [] }: Props) {
  const { displayLine, profile } = usePlanner();
  const [data, setData] = useState<{ km: number; m: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!displayLine?.geometry?.coordinates?.length) {
      setData([]);
      return;
    }
    const coords = displayLine.geometry.coordinates;
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

  /** Asse X del grafico: km o mi a seconda dell’unità. */
  const hoverDisplay = hoverKm != null ? hoverKm * conv : null;
  const vizLo = vizRange ? Math.min(vizRange.startKm, vizRange.endKm) * conv : null;
  const vizHi = vizRange ? Math.max(vizRange.startKm, vizRange.endKm) * conv : null;
  const showHoverLine =
    hoverDisplay != null &&
    (vizRange == null ||
      (hoverKm! >= Math.min(vizRange.startKm, vizRange.endKm) - 1e-6 &&
        hoverKm! <= Math.max(vizRange.startKm, vizRange.endKm) + 1e-6));

  if (!displayLine) {
    return (
      <div className="h-36 rounded border border-zinc-700/50 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500">
        Profilo altimetrico: aggiungi tappe o importa GPX per una traccia.
      </div>
    );
  }

  const lastKmFull = data.length ? data[data.length - 1].km * conv : 0;
  const lastKm = chartRows.length ? chartRows[chartRows.length - 1].km : lastKmFull;
  const gainLossData = chartRows.length >= 2 ? chartRows : data.map((d) => ({ ...d, km: d.km * conv }));
  const { gain, loss } =
    gainLossData.length >= 2 ? elevationGainLossM(gainLossData.map((d) => d.m)) : { gain: 0, loss: 0 };
  const minEl = chartRows.length ? Math.min(...chartRows.map((d) => d.m)) : data.length ? Math.min(...data.map((d) => d.m)) : 0;
  const maxEl = chartRows.length ? Math.max(...chartRows.map((d) => d.m)) : data.length ? Math.max(...data.map((d) => d.m)) : 0;

  const hoverElev =
    showHoverLine && chartRows.length >= 1 && hoverDisplay != null
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
        <span>Profilo (quota vs distanza)</span>
        {showHoverLine && hoverElev != null ? (
          <span className="text-amber-200/90">
            Cursore: ~{hoverDisplay!.toFixed(1)} {unit} · ~{Math.round(hoverElev)} m
          </span>
        ) : (
          <span className="text-zinc-600">Passa vicino alla traccia sulla mappa per il punto sul profilo</span>
        )}
      </div>
      {err && <p className="px-2 text-xs text-amber-400">{err}</p>}
      <div className="mt-1 h-32 w-full min-w-0">
        <ResponsiveContainer width="100%" height={128}>
          <LineChart data={chartRows.length >= 2 ? chartRows : chartRows.length === 1 ? [chartRows[0], chartRows[0]] : [{ km: 0, m: 0 }]}>
            <XAxis
              dataKey="km"
              tick={{ fontSize: 10, fill: "#a1a1aa" }}
              label={{ value: unit, position: "insideBottom", offset: -2, fill: "#71717a" }}
            />
            <YAxis tick={{ fontSize: 10, fill: "#a1a1aa" }} width={36} unit="m" />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
              formatter={(v) => [`${Math.round(Number(v))} m`, "Quota"]}
              labelFormatter={(l) => `Distanza: ${Number(l).toFixed(1)} ${unit}`}
            />
            <Line type="monotone" dataKey="m" stroke="#34d399" dot={false} strokeWidth={2} />
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
