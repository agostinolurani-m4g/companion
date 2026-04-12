"use client";

import { useEffect, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePlanner } from "@/context/PlannerProvider";
import { elevationGainLossM } from "@/lib/elevation";

export function ElevationChart() {
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

  if (!displayLine) {
    return (
      <div className="h-36 rounded border border-zinc-700/50 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500">
        Profilo altimetrico: aggiungi tappe o importa GPX per una traccia.
      </div>
    );
  }

  const unit = profile?.units === "mi" ? "mi" : "km";
  const conv = unit === "mi" ? 0.621371 : 1;
  const lastKm = data.length ? data[data.length - 1].km * conv : 0;
  const { gain, loss } =
    data.length >= 2 ? elevationGainLossM(data.map((d) => d.m)) : { gain: 0, loss: 0 };
  const minEl = data.length ? Math.min(...data.map((d) => d.m)) : 0;
  const maxEl = data.length ? Math.max(...data.map((d) => d.m)) : 0;

  return (
    <div className="rounded border border-zinc-700/50 bg-zinc-900/30 px-1 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2 text-[10px] text-zinc-500">
        <span>
          Distanza: <strong className="text-zinc-300">{lastKm.toFixed(1)}</strong> {unit}
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
      <div className="px-2 pt-1 text-xs text-zinc-400">Profilo altimetrico (quota vs distanza)</div>
      {err && <p className="px-2 text-xs text-amber-400">{err}</p>}
      <div className="mt-1 h-32 w-full min-w-0">
        <ResponsiveContainer width="100%" height={128}>
        <LineChart data={data.map((d) => ({ ...d, km: d.km * conv }))}>
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
        </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
