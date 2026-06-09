"use client";

import { useRef, useState } from "react";
import type { PoiCategory, PoiNoteWithPhotos, PoiRow } from "@/lib/db";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import type { StoredCoord } from "@/lib/track-coords";
import { projectLngLatToTrack } from "@/lib/track-measure";

type Props = {
  trackId: string;
  coords: StoredCoord[];
  lat: number;
  lng: number;
  onClose: () => void;
  onAdded: (poi: PoiRow, note?: PoiNoteWithPhotos) => void;
};

export default function FieldAddPoiSheet({
  trackId,
  coords,
  lat,
  lng,
  onClose,
  onAdded,
}: Props) {
  const [category, setCategory] = useState<PoiCategory>("lodging");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);

  const preview = (() => {
    const p = projectLngLatToTrack(coords, lng, lat);
    if (!p) return null;
    return { alongKm: p.alongKm, detourM: Math.round(p.distKm * 1000) };
  })();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/track/${trackId}/pois/custom`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lat,
          lng,
          category,
          name: name.trim() || undefined,
          notes: body.trim() || undefined,
          race_visible: 1,
        }),
      });
      const data = (await res.json()) as { poi?: PoiRow; error?: string };
      if (!res.ok || !data.poi) {
        setError(data.error ?? "Creazione POI non riuscita");
        return;
      }

      let note: PoiNoteWithPhotos | undefined;
      const noteRes = await fetch(`/api/track/${trackId}/field-notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          poi_id: data.poi.id,
          status: "visited",
          body: body.trim(),
        }),
      });
      const noteData = (await noteRes.json()) as { note?: PoiNoteWithPhotos; error?: string };
      if (noteRes.ok && noteData.note) {
        note = noteData.note;
      }

      if (pendingPhoto && data.poi) {
        const fd = new FormData();
        fd.append("file", pendingPhoto);
        fd.append("poi_id", data.poi.id);
        if (note?.id) fd.append("note_id", note.id);
        const upRes = await fetch(`/api/track/${trackId}/field-notes/upload`, {
          method: "POST",
          body: fd,
        });
        const upData = (await upRes.json()) as {
          note?: PoiNoteWithPhotos;
          photos?: PoiNoteWithPhotos["photos"];
        };
        if (upRes.ok && upData.note) {
          note = { ...upData.note, photos: upData.photos ?? [] };
        }
      }

      onAdded(data.poi, note);
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
      className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 pb-[calc(var(--safe-bottom)+0.5rem)]"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="hmr-panel m-2 w-full max-w-md space-y-3 p-4 text-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="text-base font-semibold">Nuovo POI sul campo</h4>
            <p className="text-[10px] text-[color:var(--hmr-muted)]">
              {lat.toFixed(5)}, {lng.toFixed(5)}
              {preview && ` · ~km ${preview.alongKm.toFixed(1)} · ${preview.detourM} m`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="hmr-btn hmr-tap text-xs">
            Chiudi
          </button>
        </div>

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Categoria
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PoiCategory)}
            className={inputCls}
          >
            {CATEGORY_ORDER.map((k) => (
              <option key={k} value={k}>
                {CATEGORY_META[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Nome <span className="text-[10px] text-[color:var(--hmr-faint)]">(facoltativo)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Commento
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Note rapide…"
            className={inputCls}
          />
        </label>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPendingPhoto(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="hmr-btn hmr-tap w-full text-xs"
          onClick={() => fileRef.current?.click()}
        >
          {pendingPhoto ? `Foto: ${pendingPhoto.name}` : "Aggiungi foto"}
        </button>

        {error && <p className="text-xs text-[color:var(--hmr-danger)]">{error}</p>}

        <button type="submit" disabled={pending} className="hmr-btn hmr-btn-accent hmr-tap w-full">
          {pending ? "Salvo…" : "Salva e confermo arrivo"}
        </button>
      </form>
    </div>
  );
}
