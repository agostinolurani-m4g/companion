"use client";

import { Fragment, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { groupStopsByLeg } from "@/lib/leg-stops";
import { isPassThroughPoint } from "@/lib/stop-segment";
import { WAYPOINT_ROLE_LABELS } from "@/lib/waypoint-role";
import type { StopRow } from "@/lib/types";

export type RouteVisualizationMode = "full" | "stop_only" | "from_stop" | "leg_to_next";

type Props = {
  stops: StopRow[];
  focusStopId: string | null;
  vizMode: RouteVisualizationMode;
  onVizModeChange: (mode: RouteVisualizationMode, focusId: string | null) => void;
  onStopClick: (stop: StopRow) => void;
  onFlyToStop?: (stop: StopRow) => void;
  /** Riordino punti dentro una singola giornata (`leg_index`). */
  onReorderLeg?: (legIndex: number, orderedIds: string[]) => void | Promise<void>;
  /** Se false, mostra istruzioni per selezionare/creare un itinerario. */
  hasActiveItinerary?: boolean;
};

const SEG_LABEL: Record<string, string> = {
  stop: "Tappa (destinazione)",
  lodging: "Rifugio / tappa",
  poi: "Punto di passaggio",
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
  onReorderLeg,
  hasActiveItinerary = true,
}: Props) {
  const [open, setOpen] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...stops].sort((a, b) => a.order_index - b.order_index),
    [stops]
  );
  const nTappe = useMemo(() => sorted.filter((s) => !isPassThroughPoint(s)).length, [sorted]);
  const nPass = useMemo(() => sorted.filter((s) => isPassThroughPoint(s)).length, [sorted]);

  const legGroups = useMemo(() => {
    const m = groupStopsByLeg(sorted);
    return [...m.keys()]
      .sort((a, b) => a - b)
      .map((leg) => ({ leg, stops: m.get(leg)! }));
  }, [sorted]);

  const dropOn = (e: DragEvent, leg: number, targetId: string) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain");
    if (!fromId || fromId === targetId || !onReorderLeg) return;
    const group = legGroups.find((g) => g.leg === leg);
    if (!group) return;
    const ids = group.stops.map((x) => x.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, fromId);
    void onReorderLeg(leg, next);
    setDraggingId(null);
  };

  return (
    <aside
      className={`flex shrink-0 flex-col border-l border-zinc-700/60 bg-zinc-950/95 transition-[width] duration-200 ${
        open ? "w-[min(100%,280px)]" : "w-9"
      }`}
    >
      <button
        type="button"
        title={open ? "Comprimi elenco percorso" : "Apri elenco percorso"}
        className="flex w-full items-start justify-between gap-1 border-b border-zinc-700/50 px-2 py-1.5 text-left text-[11px] font-medium text-zinc-300 hover:bg-zinc-800/50"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={open ? "min-w-0 flex-1" : "sr-only"}>
          <span className="block truncate">
            Percorso ({sorted.length}) — {nTappe} tappe · {nPass} passaggi
          </span>
          {open && onReorderLeg ? (
            <span className="block font-normal text-[9px] text-zinc-600">
              Trascina ⣿ dentro la stessa giornata
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-zinc-500">{open ? "▾" : "◂"}</span>
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
              <li className="px-2 py-3 text-zinc-500">
                {hasActiveItinerary ? (
                  <>
                    Nessun punto ancora. Clicca sulla mappa per aggiungere una tappa, oppure chiedi in{" "}
                    <strong className="text-zinc-400">Chat</strong> e importa un <strong className="text-zinc-400">GPX</strong>{" "}
                    se hai già la traccia.
                  </>
                ) : (
                  <>
                    Seleziona o crea un itinerario dal menu in alto. Poi clicca sulla mappa o usa la{" "}
                    <strong className="text-zinc-400">Chat</strong> per costruire il percorso.
                  </>
                )}
              </li>
            ) : (
              legGroups.map(({ leg, stops: legStops }) => (
                <Fragment key={leg}>
                  <li className="sticky top-0 z-[1] mb-1 bg-zinc-950/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600/90">
                    Giorno {leg + 1}
                  </li>
                  {legStops.map((s, i) => (
                    <li
                      key={s.id}
                      onDragOver={
                        onReorderLeg
                          ? (e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }
                          : undefined
                      }
                      onDrop={onReorderLeg ? (e) => dropOn(e, leg, s.id) : undefined}
                      className={`mb-1 rounded border px-2 py-1.5 ${
                        focusStopId === s.id && vizMode !== "full"
                          ? "border-amber-600/50 bg-amber-950/30"
                          : isPassThroughPoint(s)
                            ? "border-dashed border-slate-600/70 bg-slate-950/35"
                            : "border-zinc-700/40 bg-zinc-900/40"
                      } ${draggingId === s.id ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        {onReorderLeg ? (
                          <button
                            type="button"
                            title="Trascina per riordinare (stessa giornata)"
                            className="mt-0.5 shrink-0 cursor-grab text-zinc-500 hover:text-zinc-300 active:cursor-grabbing"
                            draggable
                            onDragStart={(e) => {
                              setDraggingId(s.id);
                              e.dataTransfer.setData("text/plain", s.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => setDraggingId(null)}
                          >
                            ⣿
                          </button>
                        ) : null}
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
                        <span
                          className={
                            isPassThroughPoint(s)
                              ? "text-slate-400"
                              : "font-medium text-zinc-400"
                          }
                        >
                          {WAYPOINT_ROLE_LABELS[s.waypoint_role] ?? s.waypoint_role}
                          <span className="text-zinc-600"> · </span>
                          {SEG_LABEL[s.segment_type] ?? s.segment_type}
                        </span>
                      </p>
                    </li>
                  ))}
                </Fragment>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
