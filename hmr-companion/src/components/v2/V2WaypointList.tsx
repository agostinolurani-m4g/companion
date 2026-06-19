"use client";

import { useState } from "react";
import type { V2Waypoint } from "@/components/v2/V2PlanMap";

type Props = {
  waypoints: V2Waypoint[];
  onReorder: (next: V2Waypoint[]) => void;
  onRemove: (index: number) => void;
  onSelect: (index: number) => void;
  selectedIndex: number | null;
};

function waypointRole(index: number, total: number): string {
  if (total === 1) return "Destinazione";
  if (index === 0) return "Partenza";
  if (index === total - 1) return "Arrivo";
  return "Tappa";
}

export default function V2WaypointList({
  waypoints,
  onReorder,
  onRemove,
  onSelect,
  selectedIndex,
}: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (waypoints.length === 0) {
    return (
      <p className="text-[11px] text-[color:var(--hmr-muted)]">
        Nessuna tappa. Clicca sulla mappa per iniziare.
      </p>
    );
  }

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= waypoints.length || to >= waypoints.length) return;
    const next = [...waypoints];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onReorder(next);
  };

  return (
    <ol className="space-y-1">
      {waypoints.map((wp, i) => (
        <li
          key={`${i}-${wp.lng.toFixed(5)}-${wp.lat.toFixed(5)}`}
          draggable
          onDragStart={() => setDragIndex(i)}
          onDragEnd={() => {
            setDragIndex(null);
            setOverIndex(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOverIndex(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIndex != null) move(dragIndex, i);
            setDragIndex(null);
            setOverIndex(null);
          }}
          className={`flex cursor-grab items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] active:cursor-grabbing ${
            selectedIndex === i
              ? "border-[color:var(--hmr-accent)]/50 bg-[color:var(--hmr-accent)]/10"
              : overIndex === i && dragIndex != null
                ? "border-[color:var(--hmr-accent)]/30 bg-[color:var(--hmr-elev)]"
                : "border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)]/60"
          }`}
        >
          <span className="shrink-0 text-[color:var(--hmr-faint)]" aria-hidden>
            ⠿
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => onSelect(i)}
          >
            <span className="font-medium text-[color:var(--hmr-accent)]">{i + 1}.</span>{" "}
            <span className="text-[color:var(--hmr-muted)]">{waypointRole(i, waypoints.length)}</span>
            {wp.label ? (
              <span className="ml-1 truncate text-[color:var(--hmr-text)]">· {wp.label}</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="shrink-0 px-1 text-[color:var(--hmr-faint)] hover:text-red-400"
            aria-label={`Elimina tappa ${i + 1}`}
          >
            ✕
          </button>
        </li>
      ))}
    </ol>
  );
}
