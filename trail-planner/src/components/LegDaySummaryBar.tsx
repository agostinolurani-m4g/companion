"use client";

import type { LegDayStat } from "@/lib/leg-day-stats";

type Props = {
  legs: LegDayStat[];
};

export function LegDaySummaryBar({ legs }: Props) {
  if (legs.length === 0) return null;
  return (
    <div className="rounded border border-zinc-700/60 bg-zinc-950/40 px-2 py-1.5 text-[10px] leading-snug text-zinc-400">
      <div className="mb-1 font-medium text-zinc-300">Giornate</div>
      <ul className="space-y-0.5">
        {legs.map((l) => (
          <li key={l.legIndex} className="flex flex-wrap gap-x-2 gap-y-0">
            <span className="text-zinc-500">Giorno {l.legIndex + 1}</span>
            <span>
              {l.stopCount} {l.stopCount === 1 ? "punto" : "punti"}
              {l.distanceKm != null ? (
                <span className="text-zinc-500"> · ~{l.distanceKm.toFixed(1)} km lungo traccia</span>
              ) : (
                <span className="text-zinc-600"> · (serve traccia sulla mappa per la distanza)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
