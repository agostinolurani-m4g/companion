"use client";

import { useEffect, useMemo, useState } from "react";
import type { V2SearchPoi } from "@/app/api/v2/pois/search/route";
import type { V2MapPlacePick } from "@/components/v2/map/types";
import type { PoiCategory } from "@/lib/db";
import { resolvePoiKind } from "@/lib/categories";
import { googleMapsSearchUrl } from "@/lib/gmaps-url";
import { SPORTS, type UserRouteActivity } from "@/lib/sports";

/** Qualsiasi cosa cliccabile sulla mappa di cui mostrare info: POI di ricerca o etichetta della mappa base. */
export type PoiBannerTarget = {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  kindLabel: string;
  kindColor: string;
  /** Riga secondaria (es. sub_kind OSM). */
  subtitle?: string | null;
  category?: PoiCategory | null;
  sub_kind: string;
  ele?: number | null;
  image?: string | null;
  description?: string | null;
  phone?: string | null;
  website?: string | null;
  opening_hours?: string | null;
  wikidata?: string | null;
  wikipedia?: string | null;
  /** Raggio (m) per le foto georeferenziate: largo per vette e paesi. */
  photoRadiusM?: number;
};

export function targetFromSearchPoi(poi: V2SearchPoi): PoiBannerTarget {
  const meta = resolvePoiKind(poi.category, poi.sub_kind);
  return {
    ...poi,
    kindLabel: meta.label,
    kindColor: meta.color,
    subtitle: poi.sub_kind,
    photoRadiusM: 250,
  };
}

const PLACE_COLOR: Record<string, string> = {
  Vetta: "#8b5e3c",
  "Passo / colle": "#8b5e3c",
  Cresta: "#8b5e3c",
  Vulcano: "#8b5e3c",
  Lago: "#3b82c4",
  Fiume: "#3b82c4",
  Torrente: "#3b82c4",
  Acque: "#3b82c4",
  Rifugio: "#c2410c",
  Bivacco: "#c2410c",
  "Parco / area protetta": "#3f8f5a",
};

export function targetFromMapPlace(place: V2MapPlacePick): PoiBannerTarget {
  const big = ["Vetta", "Città", "Lago", "Parco / area protetta", "Vulcano", "Cresta"].includes(place.kindLabel);
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    kindLabel: place.kindLabel,
    kindColor: PLACE_COLOR[place.kindLabel] ?? "#64748b",
    category: null,
    sub_kind: place.kindLabel.toLowerCase(),
    ele: place.ele ?? null,
    wikidata: place.wikidata ?? null,
    photoRadiusM: big ? 3000 : 1200,
  };
}

type Props = {
  target: PoiBannerTarget;
  /** Sport attivo: orienta il riassunto e la ricerca. */
  sport?: UserRouteActivity | null;
  onClose: () => void;
  onInsertInRoute?: () => void;
  onSetDestination?: () => void;
  /** Aggiunge il luogo come sosta della gita (non modifica la traccia). */
  onAddToOuting?: () => void;
  /** Testo del pulsante destinazione (es. "Parti da qui" senza tappe). */
  destinationLabel?: string;
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

function googleSearchUrl(q: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export default function V2PoiBanner({
  target,
  sport,
  onClose,
  onInsertInRoute,
  onSetDestination,
  onAddToOuting,
  destinationLabel = "Imposta destinazione",
}: Props) {
  const [details, setDetails] = useState<DetailsState | null>(null);
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);

  const title = target.name ?? target.sub_kind ?? "Luogo";
  const sportLabel = sport ? SPORTS[sport]?.label ?? null : null;
  const googleMapsUrl = googleMapsSearchUrl(target.lat, target.lng, target.name);
  const searchName = target.name ? `${target.name}${target.category ? "" : ` ${target.kindLabel.toLowerCase()}`}` : null;

  useEffect(() => {
    const ac = new AbortController();
    setDetails(null);
    setSummary(null);
    setLoadingDetails(true);
    setLoadingSummary(true);
    setError(null);
    setZoomed(null);

    const poiId = encodeURIComponent(target.id);
    const signal = ac.signal;

    void (async () => {
      let extract: string | null = null;

      try {
        const res = await fetch(`/api/v2/pois/${poiId}/details`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: target.lat,
            lng: target.lng,
            name: target.name,
            photoRadiusM: target.photoRadiusM,
            image: target.image ?? null,
            wikidata: target.wikidata ?? null,
            wikipedia: target.wikipedia ?? null,
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
            name: target.name,
            category: target.category ?? null,
            kind_label: target.kindLabel,
            sub_kind: target.sub_kind,
            ele: target.ele ?? null,
            sport: sportLabel,
            description: target.description ?? null,
            extract,
            opening_hours: target.opening_hours ?? null,
            phone: target.phone ?? null,
            website: target.website ?? null,
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
            text_it: extract ?? target.description ?? "Nessuna descrizione disponibile.",
            source: "template",
          });
        }
      } finally {
        if (!signal.aborted) setLoadingSummary(false);
      }
    })();

    return () => ac.abort();
  }, [target, sportLabel]);

  const photos = useMemo(() => {
    const list: string[] = [];
    const add = (u: string | null | undefined) => {
      if (u && !list.includes(u)) list.push(u);
    };
    add(target.image);
    for (const p of details?.photos ?? []) add(p);
    return list;
  }, [target.image, details?.photos]);

  const descriptionText = details?.extract?.trim() || target.description?.trim() || null;
  // Il riassunto AI di solito riprende l'estratto: mostra l'estratto solo se il riassunto non è AI.
  const showExtract = descriptionText && summary?.source !== "llm";

  const linkCls =
    "inline-flex items-center gap-1 rounded-md border border-[color:var(--hmr-border)] px-2 py-1 text-[11px] text-[color:var(--hmr-accent)] hover:bg-[color:var(--hmr-elev)]";

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-2 sm:p-3"
      role="dialog"
      aria-label={`Dettagli ${title}`}
    >
      <div className="pointer-events-auto ui-glass v2-anim-in flex max-h-[min(75dvh,38rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg">
        {zoomed ? (
          <button
            type="button"
            onClick={() => setZoomed(null)}
            className="relative block shrink-0 bg-black"
            aria-label="Chiudi foto"
          >
            <img src={zoomed} alt="" className="mx-auto max-h-[45dvh] w-full object-contain" />
            <span className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-white">
              Chiudi
            </span>
          </button>
        ) : photos.length > 0 ? (
          <div className="relative shrink-0 border-b border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)]">
            <div className="flex snap-x gap-1.5 overflow-x-auto p-2 pb-1.5">
              {photos.map((url, i) => (
                <button
                  key={`${url}-${i}`}
                  type="button"
                  onClick={() => setZoomed(url)}
                  className="shrink-0 snap-start"
                  aria-label={`Foto ${i + 1}`}
                >
                  <img
                    src={url}
                    alt=""
                    className={`${i === 0 ? "h-40 w-64" : "h-40 w-48"} rounded-lg border border-[color:var(--hmr-border)] object-cover`}
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                    }}
                  />
                </button>
              ))}
            </div>
            {loadingDetails ? (
              <div className="absolute right-3 top-3 rounded-md bg-black/50 px-2 py-0.5 text-[10px] text-white/90">
                Foto…
              </div>
            ) : null}
          </div>
        ) : loadingDetails ? (
          <div className="shrink-0 border-b border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)] px-3 py-8 text-center text-xs text-[color:var(--hmr-muted)]">
            Cerco foto e informazioni…
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: target.kindColor }} />
                <span className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-muted)]">
                  {target.kindLabel}
                  {target.ele != null ? ` · ${Math.round(target.ele)} m` : null}
                </span>
              </div>
              <h3 className="text-base font-semibold leading-snug">{title}</h3>
              <p className="mt-0.5 text-[10px] text-[color:var(--hmr-faint)]">
                {target.subtitle ? `${target.subtitle} · ` : null}
                {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
              </p>
            </div>
            <button type="button" onClick={onClose} className="hmr-btn hmr-tap shrink-0 text-xs" aria-label="Chiudi">
              Chiudi
            </button>
          </div>

          {(target.phone || target.website || target.opening_hours) && (
            <div className="mb-3 flex flex-col gap-1.5 text-xs">
              {target.phone ? (
                <a href={`tel:${target.phone.replace(/\s/g, "")}`} className="text-[color:var(--hmr-accent)] hover:underline">
                  Tel. {target.phone}
                </a>
              ) : null}
              {target.website ? (
                <a
                  href={target.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[color:var(--hmr-accent)] hover:underline"
                >
                  {target.website.replace(/^https?:\/\//i, "")}
                </a>
              ) : null}
              {target.opening_hours ? <p className="text-[color:var(--hmr-muted)]">Orari: {target.opening_hours}</p> : null}
            </div>
          )}

          <section className="mb-3 rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)]/60 p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-faint)]">
                {sportLabel ? `In breve · ${sportLabel}` : "In breve"}
              </h4>
              {summary?.source === "llm" ? (
                <span className="rounded border border-[color:var(--hmr-accent-2)]/40 bg-[color:var(--hmr-accent-2)]/15 px-1.5 py-0.5 text-[9px] font-medium text-[color:var(--hmr-accent-2)]">
                  AI
                </span>
              ) : summary ? (
                <span className="text-[9px] text-[color:var(--hmr-faint)]">automatico</span>
              ) : null}
            </div>
            {loadingSummary ? (
              <p className="text-xs text-[color:var(--hmr-muted)]">Preparo il riassunto…</p>
            ) : (
              <p className="text-xs leading-relaxed text-[color:var(--hmr-text)]">
                {summary?.text_it ?? "Nessun riassunto disponibile."}
              </p>
            )}
          </section>

          {showExtract ? (
            <p className="mb-3 text-xs leading-relaxed text-[color:var(--hmr-muted)]">{descriptionText}</p>
          ) : null}

          <div className="mb-3 flex flex-wrap gap-1.5">
            {searchName ? (
              <a href={googleSearchUrl(searchName)} target="_blank" rel="noopener noreferrer" className={linkCls}>
                Cerca su Google
              </a>
            ) : null}
            {target.name && sportLabel ? (
              <a
                href={googleSearchUrl(`${target.name} ${sportLabel.toLowerCase()}`)}
                target="_blank"
                rel="noopener noreferrer"
                className={linkCls}
              >
                Google: {sportLabel.toLowerCase()}
              </a>
            ) : null}
            {target.name ? (
              <a
                href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(searchName ?? target.name)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={linkCls}
              >
                Altre foto
              </a>
            ) : null}
            {details?.wiki_url ? (
              <a href={details.wiki_url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                Wikipedia
              </a>
            ) : null}
            <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Google Maps
            </a>
          </div>

          {error ? <p className="mb-3 text-xs text-[color:var(--hmr-danger)]">{error}</p> : null}

          {onInsertInRoute || onSetDestination || onAddToOuting ? (
            <div className="flex flex-wrap gap-2 border-t border-[color:var(--hmr-border)]/60 pt-3">
              {onInsertInRoute ? (
                <button
                  type="button"
                  onClick={onInsertInRoute}
                  className="rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
                >
                  Inserisci nel percorso
                </button>
              ) : null}
              {onSetDestination ? (
                <button
                  type="button"
                  onClick={onSetDestination}
                  className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs"
                >
                  {destinationLabel}
                </button>
              ) : null}
              {onAddToOuting ? (
                <button
                  type="button"
                  onClick={onAddToOuting}
                  className="rounded-lg border border-[color:var(--hmr-accent)]/60 px-3 py-2 text-xs text-[color:var(--hmr-accent)]"
                >
                  Aggiungi alla gita
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
