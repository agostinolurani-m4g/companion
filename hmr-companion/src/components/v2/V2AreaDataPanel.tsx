"use client";

import { OUTDOOR_GROUP_LABELS, OUTDOOR_GROUPS, type OutdoorGroup } from "@/lib/outdoor/groups";
import type { OutdoorGroupCount } from "@/lib/use-outdoor-features-map";

type Props = {
  counts: OutdoorGroupCount[];
  enabledGroups: OutdoorGroup[] | null;
  onToggleGroup: (grp: OutdoorGroup) => void;
  busy?: boolean;
};

export default function V2AreaDataPanel({ counts, enabledGroups, onToggleGroup, busy }: Props) {
  const total = counts.reduce((s, c) => s + c.n, 0);
  if (total === 0 && !busy) return null;

  const countMap = new Map(counts.map((c) => [c.grp, c.n]));

  return (
    <div className="v2-area-data">
      <div className="v2-area-data-title">Dati in quest&apos;area</div>
      <div className="v2-chip-row">
        {OUTDOOR_GROUPS.map((grp) => {
          const n = countMap.get(grp) ?? 0;
          if (n === 0) return null;
          const on = !!enabledGroups?.includes(grp);
          return (
            <button
              key={grp}
              type="button"
              aria-pressed={on}
              className={`v2-chip v2-chip-toggle ${on ? "v2-chip-on" : ""}`}
              onClick={() => onToggleGroup(grp)}
            >
              {OUTDOOR_GROUP_LABELS[grp]} · {n.toLocaleString("it")}
            </button>
          );
        })}
      </div>
      <p className="v2-muted v2-tiny">Tocca un gruppo per far risaltare i suoi punti sulla mappa.</p>
      {busy && <p className="v2-muted v2-tiny">Aggiornamento dati…</p>}
    </div>
  );
}
