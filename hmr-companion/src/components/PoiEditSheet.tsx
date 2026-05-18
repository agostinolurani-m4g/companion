"use client";

import { useState } from "react";
import type { PoiCategory, PoiRow } from "@/lib/db";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";

type Props = {
  trackId: string;
  poi: PoiRow;
  onClose: () => void;
  onSaved: (poi: PoiRow) => void;
};

export default function PoiEditSheet({ trackId, poi, onClose, onSaved }: Props) {
  const [name, setName] = useState(poi.name ?? "");
  const [category, setCategory] = useState<PoiCategory>(poi.category);
  const [raceVisible, setRaceVisible] = useState((poi.race_visible ?? 1) === 1);
  const [description, setDescription] = useState(poi.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/track/${encodeURIComponent(trackId)}/pois/custom?poiId=${encodeURIComponent(poi.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || null,
            category,
            description: description.trim() || null,
            race_visible: raceVisible ? 1 : 0,
          }),
        }
      );
      const data = (await res.json()) as { poi?: PoiRow; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.poi) onSaved(data.poi);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-[45] flex items-end justify-center bg-black/60 pb-[calc(var(--safe-bottom)+1rem)] sm:items-center"
      onClick={onClose}
    >
      <div
        className="hmr-panel m-3 w-full max-w-md overflow-hidden p-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-base font-semibold">Modifica POI</h4>
          <button type="button" className="hmr-btn hmr-tap text-xs" onClick={onClose}>
            Chiudi
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[color:var(--hmr-muted)]">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[color:var(--hmr-muted)]">Tipo</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as PoiCategory)}
              className="rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-1.5"
            >
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input type="checkbox" checked={raceVisible} onChange={(e) => setRaceVisible(e.target.checked)} />
            <span>Visibile in Race</span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[color:var(--hmr-muted)]">Nota breve</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-1.5"
            />
          </label>
          <p className="text-[10px] text-[color:var(--hmr-faint)]">
            Posizione: km {poi.along_km.toFixed(1)} sulla traccia · detour {poi.detour_m} m
          </p>
          {error && <p className="text-xs text-[color:var(--hmr-danger)]">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="hmr-btn hmr-btn-accent hmr-tap text-sm"
          >
            {busy ? "Salvo…" : "Salva"}
          </button>
        </div>
      </div>
    </div>
  );
}
