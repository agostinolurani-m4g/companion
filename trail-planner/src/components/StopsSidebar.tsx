"use client";

import { Fragment, useMemo, useState } from "react";
import type { StopRow } from "@/lib/types";

export type RouteVisualizationMode = "full" | "stop_only" | "from_stop" | "leg_to_next";

type Props = {
  stops: StopRow[];
  focusStopId: string | null;
  vizMode: RouteVisualizationMode;
  onVizModeChange: (mode: RouteVisualizationMode, focusId: string | null) => void;
  onStopClick: (stop: StopRow) => void;
  onFlyToStop?: (stop: StopRow) => void;
};

const SEG_LABEL: Record<string, string> = {
  stop: "Tappa",
  lodging: "Rifugio",
  poi: "POI",
  transport: "Trasporto",
  meal: "Pasto",
};

export function StopsSidebar({
  stops,
  focusStopId,
  vizMode,
  onVizModeChange,
  onStopClick,
  onFlyToStop,
}: Props) {
  const [open, setOpen] = useState(true);
  const sorted = useMemo(
    () => [...stops].sort((a, b) => a.order_index - b.order_index),
    [stops]
  );

  return (
    <aside
      className={`flex shrink-0 flex-col border-l border-zinc-700/60 bg-zinc-950/95 transition-[width] duration-200 ${
        open ? "w-[min(100%,280px)]" : "w-9"
      }`}
    >
      <button
        type="button"
        title={open ? "Comprimi elenco tappe" : "Apri elenco tappe"}
        className="flex items-center justify-between gap-1 border-b border-zinc-700/50 px-2 py-1.5 text-left text-[11px] font-medium text-zinc-300 hover:bg-zinc-800/50"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={open ? "truncate" : "sr-only"}>
          Tappe ({sorted.length})
        </span>
        <span className="text-zinc-500">{open ? "▾" : "◂"}</span>
      </button>
      {open ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 space-y-1 border-b border-zinc-800/80 px-2 py-2 text-[10px] text-zinc-500">
            <p className="font-medium text-zinc-400">Visualizza percorso</p>
            <select
              className="w-full rounded border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-200"
              value={
                vizMode === "full" || !focusStopId ? "full" : `${vizMode}:${focusStopId}`
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === "full") {
                  onVizModeChange("full", null);
                  return;
                }
                const i = v.indexOf(":");
                if (i === -1) return;
                const mode = v.slice(0, i) as RouteVisualizationMode;
                const id = v.slice(i + 1);
                onVizModeChange(mode, id);
              }}
            >
              <option value="full">Tutto il percorso</option>
              {sorted.map((s) => (
                <Fragment key={s.id}>
                  <option value={`stop_only:${s.id}`}>Solo — {s.name}</option>
                  <option value={`from_stop:${s.id}`}>Da qui → fine</option>
                  <option value={`leg_to_next:${s.id}`}>Fino alla tappa dopo</option>
                </Fragment>
              ))}
            </select>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-1 py-1 text-[11px]">
            {sorted.length === 0 ? (
              <li className="px-2 py-3 text-zinc-500">Nessuna tappa. Clicca sulla mappa per aggiungerne.</li>
            ) : (
              sorted.map((s, i) => (
                <li
                  key={s.id}
                  className={`mb-1 rounded border px-2 py-1.5 ${
                    focusStopId === s.id && vizMode !== "full"
                      ? "border-amber-600/50 bg-amber-950/30"
                      : "border-zinc-700/40 bg-zinc-900/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left font-medium text-zinc-100 hover:text-white"
                      onClick={() => onStopClick(s)}
                    >
                      <span className="text-zinc-500">{i + 1}. </span>
                      <span className="break-words">{s.name}</span>
                    </button>
                    {onFlyToStop ? (
                      <button
                        type="button"
                        title="Centra sulla mappa"
                        className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-400 hover:bg-zinc-700"
                        onClick={() => onFlyToStop(s)}
                      >
                        ⊕
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    {SEG_LABEL[s.segment_type] ?? s.segment_type}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
