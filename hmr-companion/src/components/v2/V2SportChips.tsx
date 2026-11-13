"use client";

import Link from "next/link";
import type { UserRouteActivity } from "@/lib/sports";
import { PLANNER_ACTIVITIES, SPORTS } from "@/lib/sports";

type Props = {
  value: UserRouteActivity;
  onChange: (sport: UserRouteActivity) => void;
  className?: string;
  options?: readonly UserRouteActivity[];
  /**
   * Nel planner lo scialpinismo ha il suo editor (salita e discesa separate): il chip "Sci"
   * porta lì. Mettere false dove lo sci non è tra gli sport possibili.
   */
  showSkiLink?: boolean;
  /** Lo sci è un'opzione come le altre (es. "Aggiungi gita"): nessun cambio pagina. */
  skiAsOption?: boolean;
};

/** Selettore sport: chip neutri, pallino col colore dello sport, selezionato in nero. */
export default function V2SportChips({
  value,
  onChange,
  className = "",
  options = PLANNER_ACTIVITIES,
  showSkiLink = true,
  skiAsOption = false,
}: Props) {
  const list = skiAsOption ? options : options.filter((id) => !SPORTS[id].skiTourMode);
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} role="radiogroup" aria-label="Sport">
      {list.map((id) => {
        const s = SPORTS[id];
        const active = value === id;
        return (
          <button key={id} type="button" role="radio" aria-checked={active} onClick={() => onChange(id)} className="ui-chip">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.shortLabel}
          </button>
        );
      })}
      {showSkiLink && !skiAsOption ? (
        <Link
          href={SPORTS.ski.plannerPath}
          role="radio"
          aria-checked={value === "ski"}
          className="ui-chip"
          title="Planner scialpinismo: traccia con salita e discesa separate"
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SPORTS.ski.color }} aria-hidden />
          {SPORTS.ski.label}
        </Link>
      ) : null}
    </div>
  );
}
