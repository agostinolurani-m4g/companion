"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/v2/ui/Icon";
import { fetchJson } from "@/lib/fetch-json";
import { highlightsToGeoJson, type HighlightDto } from "@/lib/highlights/serialize";
import type { MapPhoto } from "@/lib/photo-geo";

export type AlongPhoto = MapPhoto & { along_km: number; dist_m: number };
export type AlongHighlight = HighlightDto & { along_km: number; dist_m: number };

/**
 * Foto della community entro 300 m e highlights entro 400 m dal percorso pianificato.
 * Richiesta ritardata: mentre si trascina un punto il percorso cambia di continuo.
 */
export function useAlongMedia(routeCoords: [number, number][] | null, sport?: string) {
  const [photos, setPhotos] = useState<AlongPhoto[]>([]);
  const [highlights, setHighlights] = useState<AlongHighlight[]>([]);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const key = useMemo(
    () => (routeCoords && routeCoords.length >= 2 ? JSON.stringify([routeCoords.length, routeCoords[0], routeCoords[routeCoords.length - 1]]) : ""),
    [routeCoords],
  );

  useEffect(() => {
    if (!key || !routeCoords) {
      setPhotos([]);
      setHighlights([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      setBusy(true);
      const body = JSON.stringify({ coordinates: routeCoords, sport });
      const init = { method: "POST", headers: { "Content-Type": "application/json" }, body };
      void Promise.all([
        fetchJson<{ photos: AlongPhoto[] }>("/api/v2/photos/along", init).catch(() => ({ photos: [] })),
        fetchJson<{ items: AlongHighlight[] }>("/api/v2/highlights/along", init).catch(() => ({ items: [] })),
      ]).then(([p, h]) => {
        if (!alive) return;
        setPhotos(p.photos);
        setHighlights(h.items);
        setBusy(false);
      });
    }, 700);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la chiave riassume il percorso
  }, [key, sport, reloadKey]);

  const highlightsGeoJson = useMemo(() => (highlights.length ? highlightsToGeoJson(highlights) : null), [highlights]);
  return { photos, highlights, highlightsGeoJson, busy, reload: () => setReloadKey((k) => k + 1) };
}

/** Striscia foto + elenco highlights lungo il percorso, nel pannello di pianificazione. */
export default function V2AlongMediaPanel({
  photos,
  highlights,
  busy,
  onOpenPhoto,
  onOpenHighlight,
  onAddHighlight,
}: {
  photos: AlongPhoto[];
  highlights: AlongHighlight[];
  busy: boolean;
  onOpenPhoto: (index: number) => void;
  onOpenHighlight: (h: AlongHighlight) => void;
  onAddHighlight: (h: AlongHighlight) => void;
}) {
  if (busy && !photos.length && !highlights.length) {
    return <p className="text-[12px] text-[color:var(--hmr-muted)]">Cerco foto e highlights lungo il percorso…</p>;
  }
  if (!photos.length && !highlights.length) {
    return (
      <p className="text-[12px] text-[color:var(--hmr-muted)]">
        Nessuna foto o highlight della community lungo questo percorso. Aggiungili da Esplora.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {photos.length ? (
        <div>
          <p className="mb-1 text-[11.5px] text-[color:var(--hmr-muted)]">
            {photos.length} foto entro 300 m · tocca per la galleria
          </p>
          <div className="ui-no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {photos.map((p, i) =>
              p.url ? (
                <button key={p.id} type="button" onClick={() => onOpenPhoto(i)} className="relative shrink-0" title={p.caption || undefined}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- foto utente */}
                  <img src={p.url} alt={p.caption || "Foto lungo il percorso"} className="h-20 w-20 rounded-lg object-cover" loading="lazy" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                    km {p.along_km.toFixed(1)}
                  </span>
                </button>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
      {highlights.length ? (
        <ul className="space-y-1">
          {highlights.map((h) => (
            <li key={h.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-[color:var(--hmr-elev)]">
              <button type="button" onClick={() => onOpenHighlight(h)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                {h.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- copertina
                  <img src={h.cover_url} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-amber-500/15 text-amber-600">
                    <Icon name="star" size={16} />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{h.name}</span>
                  <span className="block text-[11px] text-[color:var(--hmr-muted)]">
                    km {h.along_km.toFixed(1)} · {h.dist_m < 30 ? "sul percorso" : `a ${h.dist_m} m`} · ★ {h.votes}
                  </span>
                </span>
              </button>
              {h.dist_m >= 30 ? (
                <button type="button" className="ui-btn ui-btn-sm shrink-0" onClick={() => onAddHighlight(h)} title="Passa di qui">
                  <Icon name="plus" size={14} /> Tappa
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
