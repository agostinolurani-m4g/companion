"use client";

import { acclimatizationWarnings, addDaysIso, type Stage } from "@/lib/multiday";
import { formatDuration } from "@/lib/route-time";

type Props = {
  stages: readonly Stage[];
  /** Primo giorno (`YYYY-MM-DD`): se presente ogni tappa mostra la sua data. */
  startDate?: string | null;
  className?: string;
};

export function stageDayLabel(startDate: string | null | undefined, day: number): string {
  if (!startDate) return `Giorno ${day}`;
  const d = new Date(`${addDaysIso(startDate, day - 1)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return `Giorno ${day}`;
  return `Giorno ${day} · ${d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}`;
}

/** Tappe di una gita di più giorni: distanza, dislivello, tempo e quota del pernotto. */
export default function V2StageList({ stages, startDate = null, className = "" }: Props) {
  const warnings = acclimatizationWarnings(stages);
  return (
    <div className={className}>
      <ol className="space-y-1.5">
        {stages.map((s) => (
          <li key={s.day} className="rounded-lg border border-[color:var(--hmr-border)]/60 px-2.5 py-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--hmr-faint)]">
              {stageDayLabel(startDate, s.day)}
            </p>
            <p className="text-[13px] font-semibold tabular-nums">
              {s.length_km.toFixed(1)} km · +{s.gain_m} m · −{s.loss_m} m · {formatDuration(s.duration_min)}
            </p>
            <p className="text-[11.5px] text-[color:var(--hmr-muted)]">
              {s.max_ele_m != null ? `Quota max ${s.max_ele_m} m` : "Quota non disponibile"}
              {s.overnight
                ? ` · notte${s.overnight_name ? ` a ${s.overnight_name}` : ""}${s.end.ele != null ? ` (${Math.round(s.end.ele)} m)` : ""}`
                : " · arrivo"}
            </p>
          </li>
        ))}
      </ol>
      {warnings.map((w) => (
        <p key={w.day} className="mt-1.5 rounded-lg bg-[color:var(--hmr-warn)]/10 px-2.5 py-1.5 text-[11.5px] text-[color:var(--hmr-warn)]">
          {w.text}
        </p>
      ))}
    </div>
  );
}
