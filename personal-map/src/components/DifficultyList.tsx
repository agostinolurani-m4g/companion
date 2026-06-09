"use client";

import type { TrackDifficultySegmentRow } from "@/lib/db";

const SEVERITY_COLORS: Record<string, string> = {
  info: "#94a3b8",
  caution: "#fbbf24",
  hard: "#f87171",
  extreme: "#c084fc",
};

type Props = {
  segments: TrackDifficultySegmentRow[];
  onSelectKm: (km: number) => void;
};

export default function DifficultyList({ segments, onSelectKm }: Props) {
  if (segments.length === 0) {
    return (
      <p className="p-3 text-xs text-[color:var(--hmr-muted)]">
        Nessun tratto critico rilevato. Usa &quot;Analizza difficoltà&quot; nel tab Diario.
      </p>
    );
  }

  return (
    <ul className="space-y-2 p-3">
      {segments.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onSelectKm((s.km_start + s.km_end) / 2)}
            className="hmr-panel w-full rounded-lg p-2 text-left text-xs"
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: SEVERITY_COLORS[s.severity] ?? "#94a3b8" }}
              />
              <span className="font-medium">{s.label}</span>
            </div>
            <p className="mt-1 text-[color:var(--hmr-muted)]">
              km {s.km_start.toFixed(1)}–{s.km_end.toFixed(1)} · {s.source}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}
