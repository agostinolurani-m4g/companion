"use client";

import { useState } from "react";
import type { PoiCategory, PoiRow } from "@/lib/db";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";

type Props = {
  trackId: string;
  onClose: () => void;
  onAdded: (poi: PoiRow) => void;
};

export default function AddPoiSheet({ trackId, onClose, onAdded }: Props) {
  const [mapsUrl, setMapsUrl] = useState("");
  const [category, setCategory] = useState<PoiCategory>("lodging");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!mapsUrl.trim()) {
      setError("Incolla un link Google Maps.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/track/${trackId}/pois/custom`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mapsUrl: mapsUrl.trim(),
          category,
          name: name.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { poi?: PoiRow; error?: string };
      if (!res.ok || !data.poi) {
        setError(data.error ?? "Errore sconosciuto");
        return;
      }
      onAdded(data.poi);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2.5 py-2 text-sm text-[color:var(--hmr-text)] outline-none placeholder:text-[color:var(--hmr-faint)] focus:border-[color:var(--hmr-accent)]";

  return (
    <div
      className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 pb-[calc(var(--safe-bottom)+1rem)] sm:items-center sm:pb-0"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="hmr-panel m-3 w-full max-w-md space-y-3 p-4 text-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-base font-semibold">Aggiungi POI</h4>
            <p className="text-[10px] text-[color:var(--hmr-muted)]">
              Incolla un link Google Maps — estraggo nome e coordinate, tu scegli la categoria.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hmr-btn hmr-tap text-xs"
          >
            Chiudi
          </button>
        </div>

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Link Google Maps
          <textarea
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/…  oppure  https://www.google.com/maps/place/…"
            rows={2}
            className={inputCls}
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Categoria
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PoiCategory)}
            className={inputCls}
          >
            {CATEGORY_ORDER.map((k) => (
              <option key={k} value={k}>
                {CATEGORY_META[k].emoji} {CATEGORY_META[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Nome <span className="text-[10px] text-[color:var(--hmr-faint)]">(facoltativo — se vuoto uso quello dal link)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Note <span className="text-[10px] text-[color:var(--hmr-faint)]">(facoltativo)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="es. prezzo, orario, numero di letti…"
            className={inputCls}
          />
        </label>

        {error && (
          <p className="text-xs text-[color:var(--hmr-danger)]">⚠ {error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="hmr-btn hmr-btn-accent hmr-tap w-full"
        >
          {pending ? "Salvataggio…" : "Salva POI"}
        </button>
      </form>
    </div>
  );
}
