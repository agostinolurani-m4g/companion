"use client";

import { MAP_ACTIVITY_OPTIONS } from "@/lib/activity-options";
import { usePlanner } from "@/context/PlannerProvider";

export function MapActivitySettings() {
  const { itinerary, activeItineraryId, updateItineraryActivity } = usePlanner();
  const raw = itinerary?.activity ?? "hiking";
  const known = MAP_ACTIVITY_OPTIONS.some((o) => o.value === raw);
  const hint = MAP_ACTIVITY_OPTIONS.find((o) => o.value === raw)?.routingHint ?? "—";

  return (
    <div className="shrink-0 rounded-lg border border-zinc-700/60 bg-zinc-900/50 px-2 py-1.5">
      <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        Modalità mappa e routing
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="max-w-full flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 min-w-[200px]"
          disabled={!activeItineraryId}
          value={raw}
          onChange={(e) => void updateItineraryActivity(e.target.value)}
        >
          {!known && (
            <option value={raw}>
              {String(raw)} (attuale)
            </option>
          )}
          {MAP_ACTIVITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-zinc-500">
        Colore della traccia sulla mappa e profilo «Traccia su strada» (OSRM): {known ? hint : `valore non in elenco (${String(raw)}).`}
        {!activeItineraryId ? " — seleziona o crea un itinerario." : ""}
      </p>
    </div>
  );
}
