"use client";

import { useCallback, useRef, useState } from "react";
import type { PoiFieldPhotoRow, PoiNoteWithPhotos, PoiRow } from "@/lib/db";
import { CATEGORY_META } from "@/lib/categories";

type Props = {
  trackId: string;
  poi: PoiRow;
  initialNote?: PoiNoteWithPhotos | null;
  onClose: () => void;
  onSaved: (note: PoiNoteWithPhotos) => void;
};

function photoUrl(path: string): string {
  return `/api/field-photo?path=${encodeURIComponent(path)}`;
}

export default function FieldPoiSheet({
  trackId,
  poi,
  initialNote,
  onClose,
  onSaved,
}: Props) {
  const [body, setBody] = useState(initialNote?.body ?? "");
  const [visited, setVisited] = useState(initialNote?.status === "visited");
  const [photos, setPhotos] = useState(initialNote?.photos ?? []);
  const [noteId, setNoteId] = useState(initialNote?.id ?? null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveNote = useCallback(
    async (markVisited: boolean) => {
      setPending(true);
      setError(null);
      try {
        const res = await fetch(`/api/track/${trackId}/field-notes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            poi_id: poi.id,
            status: markVisited ? "visited" : visited ? "visited" : "info",
            body: body.trim(),
          }),
        });
        const data = (await res.json()) as { note?: PoiNoteWithPhotos; error?: string };
        if (!res.ok || !data.note) {
          setError(data.error ?? "Salvataggio non riuscito");
          return null;
        }
        setNoteId(data.note.id);
        if (markVisited) setVisited(true);
        const merged = { ...data.note, photos };
        onSaved(merged);
        return data.note;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setPending(false);
      }
    },
    [trackId, poi.id, body, visited, photos, onSaved]
  );

  const handleConfirm = async () => {
    const note = await saveNote(true);
    if (note) onClose();
  };

  const handlePhoto = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("poi_id", poi.id);
      if (noteId) fd.append("note_id", noteId);

      const res = await fetch(`/api/track/${trackId}/field-notes/upload`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        photo?: PoiFieldPhotoRow;
        note?: { id: string; status: string; body: string };
        photos?: PoiFieldPhotoRow[];
        error?: string;
      };
      if (!res.ok || !data.photo) {
        setError(data.error ?? "Upload non riuscito");
        return;
      }
      if (data.note?.id) setNoteId(data.note.id);
      const nextPhotos: PoiFieldPhotoRow[] = data.photos ?? [...photos, data.photo];
      setPhotos(nextPhotos);
      if (data.note) {
        onSaved({
          id: data.note.id,
          poi_id: poi.id,
          status: (data.note.status as PoiNoteWithPhotos["status"]) ?? "visited",
          body: data.note.body ?? body,
          created_at: initialNote?.created_at ?? Date.now(),
          updated_at: Date.now(),
          photos: nextPhotos,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2.5 py-2 text-sm text-[color:var(--hmr-text)] outline-none placeholder:text-[color:var(--hmr-faint)] focus:border-[color:var(--hmr-accent)]";

  const catLabel = CATEGORY_META[poi.category]?.label ?? poi.category;

  return (
    <div
      className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 pb-[calc(var(--safe-bottom)+0.5rem)]"
      onClick={onClose}
    >
      <div
        className="hmr-panel m-2 w-full max-w-md max-h-[min(85dvh,36rem)] overflow-y-auto p-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h4 className="text-base font-semibold">{poi.name ?? poi.sub_kind ?? "POI"}</h4>
            <p className="text-xs text-[color:var(--hmr-muted)]">
              {catLabel} · km {poi.along_km.toFixed(1)}
              {visited && (
                <span className="ml-2 rounded border border-emerald-500/50 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                  Arrivato
                </span>
              )}
            </p>
          </div>
          <button type="button" onClick={onClose} className="hmr-btn hmr-tap text-xs">
            Chiudi
          </button>
        </div>

        <label className="mb-3 flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Commento
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Orari, prezzo, stato locale…"
            className={inputCls}
          />
        </label>

        {photos.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {photos.map((p) => (
              <img
                key={p.id}
                src={photoUrl(p.photo_path)}
                alt=""
                className="h-16 w-16 rounded-md border border-[color:var(--hmr-border)] object-cover"
              />
            ))}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handlePhoto(f);
            e.target.value = "";
          }}
        />

        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="hmr-btn hmr-tap w-full text-xs"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "Caricamento foto…" : "Aggiungi foto"}
          </button>

          <button
            type="button"
            className="hmr-btn hmr-btn-accent hmr-tap w-full text-sm font-semibold"
            disabled={pending}
            onClick={() => void handleConfirm()}
          >
            {pending ? "Salvo…" : visited ? "Aggiorna arrivo" : "Confermo arrivo"}
          </button>

          {!visited && (
            <button
              type="button"
              className="hmr-btn hmr-tap w-full text-xs"
              disabled={pending}
              onClick={() => void saveNote(false)}
            >
              Salva solo commento
            </button>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-[color:var(--hmr-danger)]">{error}</p>}
      </div>
    </div>
  );
}
