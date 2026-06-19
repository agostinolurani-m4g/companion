"use client";

import { useEffect, useMemo, useState } from "react";
import type { V2SearchPoi } from "@/app/api/v2/pois/search/route";
import { CATEGORY_META } from "@/lib/categories";

type Props = {
  poi: V2SearchPoi;
  onClose: () => void;
  onInsertInRoute: () => void;
  onSetDestination: () => void;
};

type DetailsState = {
  photos: string[];
  extract: string | null;
  wiki_url: string | null;
};

type SummaryState = {
  text_it: string;
  source: "template" | "llm";
};

export default function V2PoiBanner({ poi, onClose, onInsertInRoute, onSetDestination }: Props) {
  const [details, setDetails] = useState<DetailsState | null>(null);
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const title = poi.name ?? poi.sub_kind ?? "POI";
  const catLabel = CATEGORY_META[poi.category]?.label ?? poi.category;
  const catColor = CATEGORY_META[poi.category]?.color ?? "#38bdf8";

  useEffect(() => {
    const ac = new AbortController();
    setDetails(null);
    setSummary(null);
    setLoadingDetails(true);
    setLoadingSummary(true);
    setError(null);

    const poiId = encodeURIComponent(poi.id);
    const signal = ac.signal;

    void (async () => {
      let extract: string | null = null;

      try {
        const res = await fetch(`/api/v2/pois/${poiId}/details`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: poi.lat,
            lng: poi.lng,
            image: poi.image ?? null,
            wikidata: poi.wikidata ?? null,
            wikipedia: poi.wikipedia ?? null,
          }),
          signal,
        });
        const data = (await res.json()) as DetailsState & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Dettagli non disponibili");
        if (!signal.aborted) {
          setDetails(data);
          extract = data.extract;
        }
      } catch (e) {
        if (!signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!signal.aborted) setLoadingDetails(false);
      }

      try {
        const res = await fetch(`/api/v2/pois/${poiId}/summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: poi.name,
            category: poi.category,
            sub_kind: poi.sub_kind,
            description: poi.description ?? null,
            extract,
            opening_hours: poi.opening_hours ?? null,
            phone: poi.phone ?? null,
            website: poi.website ?? null,
            useLlm: true,
          }),
          signal,
        });
        const data = (await res.json()) as SummaryState & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Riassunto non disponibile");
        if (!signal.aborted) setSummary(data);
      } catch {
        if (!signal.aborted) {
          setSummary({
            text_it: extract ?? poi.description ?? "Punto di interesse segnalato su OpenStreetMap.",
            source: "template",
          });
        }
      } finally {
        if (!signal.aborted) setLoadingSummary(false);
      }
    })();

    return () => ac.abort();
  }, [poi]);

  const photos = useMemo(() => {
    const list: string[] = [];
    const add = (u: string | null | undefined) => {
      if (u && !list.includes(u)) list.push(u);
    };
    add(poi.image);
    for (const p of details?.photos ?? []) add(p);
    return list;
  }, [poi.image, details?.photos]);

  const descriptionText = details?.extract?.trim() || poi.description?.trim() || null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-2 pb-[calc(0.5rem+var(--safe-bottom,0px))] sm:inset-x-auto sm:bottom-3 sm:left-3 sm:justify-start sm:p-0"
      role="dialog"
      aria-label={`Dettagli ${title}`}
    >
      <div className="pointer-events-auto hmr-panel flex max-h-[min(78dvh,34rem)] w-full max-w-lg flex-col overflow-hidden shadow-xl">
        {photos.length > 0 ? (
          <div className="relative shrink-0 border-b border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)]">
            <div className="flex gap-1 overflow-x-auto p-2 pb-1">
              {photos.map((url, i) => (
                <img
                  key={`${url}-${i}`}
                  src={url}
                  alt=""
                  className="h-28 w-40 shrink-0 rounded-lg border border-[color:var(--hmr-border)] object-cover"
                  loading="lazy"
                />
              ))}
            </div>
            {loadingDetails ? (
              <div className="absolute right-3 top-3 rounded-md bg-black/50 px-2 py-0.5 text-[10px] text-white/90">
                Foto…
              </div>
            ) : null}
          </div>
        ) : loadingDetails ? (
          <div className="shrink-0 border-b border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)] px-3 py-6 text-center text-xs text-[color:var(--hmr-muted)]">
            Carico foto e dettagli…
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: catColor }}
                />
                <span className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-muted)]">
                  {catLabel}
                </span>
              </div>
              <h3 className="text-base font-semibold leading-snug">{title}</h3>
              <p className="mt-0.5 text-[10px] text-[color:var(--hmr-faint)]">
                {poi.sub_kind}
                {poi.lat && poi.lng ? ` · ${poi.lat.toFixed(5)}, ${poi.lng.toFixed(5)}` : null}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="hmr-btn hmr-tap shrink-0 text-xs"
              aria-label="Chiudi"
            >
              Chiudi
            </button>
          </div>

          {(poi.phone || poi.website || poi.opening_hours) && (
            <div className="mb-3 flex flex-col gap-1.5 text-xs">
              {poi.phone ? (
                <a
                  href={`tel:${poi.phone.replace(/\s/g, "")}`}
                  className="text-[color:var(--hmr-accent)] hover:underline"
                >
                  Tel. {poi.phone}
                </a>
              ) : null}
              {poi.website ? (
                <a
                  href={poi.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[color:var(--hmr-accent)] hover:underline"
                >
                  {poi.website.replace(/^https?:\/\//i, "")}
                </a>
              ) : null}
              {poi.opening_hours ? (
                <p className="text-[color:var(--hmr-muted)]">Orari: {poi.opening_hours}</p>
              ) : null}
            </div>
          )}

          {descriptionText ? (
            <p className="mb-3 text-xs leading-relaxed text-[color:var(--hmr-muted)]">{descriptionText}</p>
          ) : null}

          {details?.wiki_url ? (
            <a
              href={details.wiki_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-3 inline-block text-[11px] text-[color:var(--hmr-accent)] hover:underline"
            >
              Leggi su Wikipedia
            </a>
          ) : null}

          <section className="mb-4 rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)]/60 p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-faint)]">
                Riassunto
              </h4>
              {summary?.source === "llm" ? (
                <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-300">
                  AI
                </span>
              ) : summary ? (
                <span className="text-[9px] text-[color:var(--hmr-faint)]">automatico</span>
              ) : null}
            </div>
            {loadingSummary ? (
              <p className="text-xs text-[color:var(--hmr-muted)]">Genero riassunto…</p>
            ) : (
              <p className="text-xs leading-relaxed text-[color:var(--hmr-text)]">
                {summary?.text_it ?? "Nessun riassunto disponibile."}
              </p>
            )}
          </section>

          {error ? <p className="mb-3 text-xs text-[color:var(--hmr-danger)]">{error}</p> : null}

          <div className="flex flex-wrap gap-2 border-t border-[color:var(--hmr-border)]/60 pt-3">
            <button
              type="button"
              onClick={onInsertInRoute}
              className="rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
            >
              Inserisci nel percorso
            </button>
            <button
              type="button"
              onClick={onSetDestination}
              className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs"
            >
              Imposta destinazione
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
