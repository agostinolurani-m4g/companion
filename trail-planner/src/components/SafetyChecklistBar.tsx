"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePlanner } from "@/context/PlannerProvider";
import { parseSafetyChecklistJson, stringifySafetyChecklistJson } from "@/lib/safety-checklist";
import type { SafetyChecklistManual } from "@/lib/types";

type Props = {
  onOpenWeatherTab: () => void;
};

function displayed(manual: SafetyChecklistManual, key: keyof SafetyChecklistManual, auto: boolean): boolean {
  if (manual[key] !== undefined) return manual[key] === true;
  return auto;
}

/** Riepilogo compatto per la sicurezza in uscita (dati già presenti in app + conferme salvate). */
export function SafetyChecklistBar({ onOpenWeatherTab }: Props) {
  const { itinerary, weatherAlerts, hasGpxTrack, stops, displayLine, activeItineraryId, selectItinerary } =
    usePlanner();

  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNotes(itinerary?.planner_notes ?? "");
  }, [itinerary?.id, itinerary?.planner_notes]);

  const persistChecklist = useCallback(
    async (manual: SafetyChecklistManual) => {
      if (!activeItineraryId || !itinerary) return;
      setSaving(true);
      try {
        const safety_checklist_json = stringifySafetyChecklistJson(manual);
        await fetch(`/api/itineraries/${activeItineraryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: itinerary.name,
            safety_checklist_json,
            planner_notes: notes.trim() || null,
          }),
        });
        await selectItinerary(activeItineraryId);
      } finally {
        setSaving(false);
      }
    },
    [activeItineraryId, itinerary, notes, selectItinerary]
  );

  const persistNotes = useCallback(async () => {
    if (!activeItineraryId || !itinerary) return;
    if (notes === (itinerary.planner_notes ?? "")) return;
    setSaving(true);
    try {
      await fetch(`/api/itineraries/${activeItineraryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: itinerary.name,
          safety_checklist_json: itinerary.safety_checklist_json ?? null,
          planner_notes: notes.trim() || null,
        }),
      });
      await selectItinerary(activeItineraryId);
    } finally {
      setSaving(false);
    }
  }, [activeItineraryId, itinerary, notes, selectItinerary]);

  if (!itinerary) return null;

  const manual = parseSafetyChecklistJson(itinerary.safety_checklist_json);
  const hasDates = !!(itinerary.start_date && itinerary.end_date);
  const hasRoute = !!displayLine?.geometry?.coordinates?.length;
  const ski = itinerary.activity === "ski_mountaineering" || itinerary.activity === "nordic_ski";

  const autoDates = hasDates;
  const autoWeather = weatherAlerts.length === 0;
  const autoRoute = stops.length >= 2 || hasRoute;
  const autoGpx = hasGpxTrack;
  const autoSki = false;

  const toggle = (key: keyof SafetyChecklistManual, auto: boolean) => {
    const cur = displayed(manual, key, auto);
    const next: SafetyChecklistManual = { ...manual, [key]: !cur };
    void persistChecklist(next);
  };

  const row = (key: keyof SafetyChecklistManual, auto: boolean, label: ReactNode) => {
    const ok = displayed(manual, key, auto);
    return (
      <li className="flex flex-col gap-0.5 border-b border-brand-border/50 pb-0.5 last:border-0">
        <div className="flex gap-1">
          <button
            type="button"
            title="Clic per alternare (salvato sull’itinerario)"
            className={`shrink-0 ${ok ? "text-brand-accent" : "text-brand-warn"}`}
            onClick={() => toggle(key, auto)}
            disabled={saving}
          >
            {ok ? "✓" : "○"}
          </button>
          <span className="min-w-0 flex-1">{label}</span>
        </div>
      </li>
    );
  };

  return (
    <div className="rounded-lg border border-brand-border/70 bg-brand-bg/50 px-2 py-1.5 text-[10px] leading-snug text-brand-muted">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-brand-text/90">Check rapida</span>
        {saving ? <span className="text-[9px] text-brand-faint">Salvataggio…</span> : null}
      </div>
      <ul className="space-y-0.5">
        {row(
          "dates",
          autoDates,
          <>
            Date itinerario{" "}
            {hasDates ? (
              <span className="text-brand-faint">
                ({itinerary.start_date} → {itinerary.end_date})
              </span>
            ) : (
              <span className="text-brand-faint">— impostale in chat o modifica itinerario</span>
            )}
          </>
        )}
        {row(
          "weather",
          autoWeather,
          <>
            Meteo:{" "}
            {weatherAlerts.length === 0 ? (
              "nessuna allerta sopra soglia"
            ) : (
              <button
                type="button"
                className="text-amber-200/90 underline hover:text-amber-100"
                onClick={onOpenWeatherTab}
              >
                {weatherAlerts.length} avviso/i — apri tab meteo
              </button>
            )}
          </>
        )}
        {row("route", autoRoute, <>Percorso: {hasRoute ? "traccia sulla mappa" : "aggiungi tappe o GPX"}</>)}
        {row(
          "gpx",
          autoGpx,
          <>GPX in app {hasGpxTrack ? "(utile in GPS)" : "— importa se usi un navigatore offline"}</>
        )}
        {ski
          ? row(
              "ski",
              autoSki,
              <>Sci: consulta bollettino valanghe ufficiale della zona prima di uscire.</>
            )
          : null}
      </ul>
      <label className="mt-2 block text-[9px] text-brand-muted">
        Note piano (salvate sull’itinerario)
        <textarea
          className="mt-0.5 w-full rounded-lg border border-brand-border bg-brand-bg px-1.5 py-1 text-[10px] text-brand-text placeholder:text-brand-faint focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/25"
          rows={2}
          placeholder="Attrezzatura, contatti, promemoria…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => void persistNotes()}
        />
      </label>
    </div>
  );
}
