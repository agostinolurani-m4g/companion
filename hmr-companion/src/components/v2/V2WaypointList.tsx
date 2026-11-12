"use client";

import { useState } from "react";
import type { V2Waypoint } from "@/components/v2/V2PlanMap";
import Icon from "@/components/v2/ui/Icon";

type Props = {
  waypoints: V2Waypoint[];
  onReorder: (next: V2Waypoint[]) => void;
  onRemove: (index: number) => void;
  onSelect: (index: number) => void;
  selectedIndex: number | null;
};

function waypointRole(index: number, total: number): "start" | "end" | "via" | "single" {
  if (total === 1) return "single";
  if (index === 0) return "start";
  if (index === total - 1) return "end";
  return "via";
}

const ROLE_LABEL = { start: "Partenza", end: "Arrivo", via: "Tappa", single: "Partenza" } as const;

function fmtCoord(wp: V2Waypoint) {
  return `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`;
}

export default function V2WaypointList({ waypoints, onReorder, onRemove, onSelect, selectedIndex }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (waypoints.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-[color:var(--hmr-border)] px-3 py-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color:var(--hmr-accent-dim)] text-[color:var(--hmr-accent)]">
          <Icon name="pin" size={18} />
        </span>
        <div className="text-[12.5px] leading-snug">
          <p className="font-semibold">Tocca la mappa per iniziare</p>
          <p className="text-[color:var(--hmr-muted)]">Il primo punto è la partenza, poi aggiungi tappe e arrivo.</p>
        </div>
      </div>
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
    <ol className="relative">
      {waypoints.length > 1 ? (
        <span
          aria-hidden
          className="absolute bottom-5 left-[25px] top-5 w-[2px] rounded bg-gradient-to-b from-[#3f8f86] via-[color:var(--hmr-border)] to-[#7d6bc4]"
        />
      ) : null}
      {waypoints.map((wp, i) => {
        const role = waypointRole(i, waypoints.length);
        const selected = selectedIndex === i;
        return (
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
            className={`group relative flex items-center gap-2 rounded-xl py-1 pl-1 pr-1 transition-colors ${
              selected
                ? "bg-[color:var(--hmr-accent-dim)]"
                : overIndex === i && dragIndex != null
                  ? "bg-[color:var(--hmr-elev)]"
                  : "hover:bg-[color:var(--hmr-elev)]/70"
            }`}
          >
            <span className="cursor-grab text-[color:var(--hmr-faint)] opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
              <Icon name="grip" size={14} />
            </span>
            <span
              className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                role === "via"
                  ? "border-2 border-[color:var(--hmr-text)] bg-[color:var(--hmr-surface)] text-[color:var(--hmr-text)]"
                  : "text-white"
              }`}
              style={role === "start" || role === "single" ? { background: "#3f8f86" } : role === "end" ? { background: "#7d6bc4" } : undefined}
            >
              {i + 1}
            </span>
            <button type="button" className="min-w-0 flex-1 py-1 text-left" onClick={() => onSelect(i)}>
              <span className="block truncate text-[13px] font-semibold">{wp.label || ROLE_LABEL[role]}</span>
              <span className="block truncate text-[11px] text-[color:var(--hmr-faint)]">
                {wp.label ? ROLE_LABEL[role] : fmtCoord(wp)}
              </span>
            </button>
            <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                className="ui-icon-btn !h-7 !w-7 !rounded-lg"
                aria-label={`Sposta su tappa ${i + 1}`}
              >
                <Icon name="chevronUp" size={15} />
              </button>
              <button
                type="button"
                onClick={() => move(i, i + 1)}
                disabled={i === waypoints.length - 1}
                className="ui-icon-btn !h-7 !w-7 !rounded-lg"
                aria-label={`Sposta giù tappa ${i + 1}`}
              >
                <Icon name="chevronDown" size={15} />
              </button>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="ui-icon-btn !h-7 !w-7 !rounded-lg hover:!text-[color:var(--hmr-danger)]"
                aria-label={`Elimina tappa ${i + 1}`}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
