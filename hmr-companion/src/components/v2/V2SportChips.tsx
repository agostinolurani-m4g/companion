"use client";

import Link from "next/link";
import type { UserRouteActivity } from "@/lib/sports";
import { PLANNER_ACTIVITIES, SPORTS } from "@/lib/sports";

type Props = {
  value: UserRouteActivity;
  onChange: (sport: UserRouteActivity) => void;
  className?: string;
  options?: readonly UserRouteActivity[];
  /** Mostra la scorciatoia al planner scialpinismo (salita/discesa). */
  showSkiLink?: boolean;
};

/** Selettore sport: chip neutri, pallino col colore dello sport, selezionato in nero. */
export default function V2SportChips({
  value,
  onChange,
  className = "",
  options = PLANNER_ACTIVITIES,
  showSkiLink = true,
}: Props) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} role="radiogroup" aria-label="Sport">
      {options.map((id) => {
        const s = SPORTS[id];
        const active = value === id;
        return (
          <button key={id} type="button" role="radio" aria-checked={active} onClick={() => onChange(id)} className="ui-chip">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.shortLabel}
          </button>
        );
      })}
      {showSkiLink ? (
        <Link
          href="/v2/scialpinismo/nuova"
          className="ui-chip !border-dashed !text-[color:var(--hmr-muted)]"
          title="Planner scialpinismo con salita e discesa separate"
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SPORTS.ski.color }} aria-hidden />
          Scialpinismo →
        </Link>
      ) : null}
    </div>
  );
}
