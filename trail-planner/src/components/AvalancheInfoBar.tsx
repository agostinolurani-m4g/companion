"use client";

import type { StopRow } from "@/lib/types";

type Props = {
  activity: string;
  stops: StopRow[];
};

/** Link a bollettini e mappe valanghe (nessun overlay proprietario; dati ufficiali sul sito di riferimento). */
export function AvalancheInfoBar({ activity, stops }: Props) {
  if (activity !== "ski_mountaineering" && activity !== "nordic_ski") return null;
  const mid = stops[Math.floor(stops.length / 2)];
  const lat = mid?.lat ?? 46.4;
  const lng = mid?.lng ?? 11.3;

  return (
    <div className="rounded border border-amber-800/50 bg-amber-950/30 px-2 py-1.5 text-[10px] leading-snug text-amber-100/90">
      <span className="font-medium text-amber-200/95">Valanghe / neve</span>
      <span className="text-zinc-500"> — consulta sempre il bollettino ufficiale della zona. </span>
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-400 underline hover:text-sky-300"
      >
        Area su Maps
      </a>
      {" · "}
      <a
        href="https://www.whiterisk.ch/en"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-400 underline hover:text-sky-300"
      >
        White Risk (CH)
      </a>
      {" · "}
      <a
        href="https://www.meteomont.gov.it/it/valanghe"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-400 underline hover:text-sky-300"
      >
        Meteomont (IT)
      </a>
    </div>
  );
}
