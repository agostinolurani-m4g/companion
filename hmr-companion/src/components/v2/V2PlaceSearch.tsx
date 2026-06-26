"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PoiKindMeta } from "@/lib/categories";
import { matchSearchKinds } from "@/lib/categories";
import type { PlaceSearchKind } from "@/lib/geocoding";

export type PlaceSearchResult = {
  lat: number;
  lng: number;
  display_name: string;
  type: string | null;
  category: string | null;
};

type Props = {
  onSelect: (place: PlaceSearchResult, kind: PlaceSearchKind) => void;
  onCategorySearch: (kind: PoiKindMeta) => void;
  mapCenter?: { lat: number; lng: number };
  viewportReady?: boolean;
  poiBusy?: boolean;
};

function shortLabel(name: string): string {
  const parts = name.split(",").map((s) => s.trim());
  return parts.slice(0, 2).join(", ");
}

export default function V2PlaceSearch({
  onSelect,
  onCategorySearch,
  mapCenter,
  viewportReady = true,
  poiBusy = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const categoryMatches = useMemo(() => matchSearchKinds(query), [query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setErr(null);
      return;
    }
    timerRef.current = setTimeout(() => {
      void (async () => {
        setBusy(true);
        setErr(null);
        try {
          const params = new URLSearchParams({ q, kind: "all" });
          if (mapCenter) {
            params.set("lat", String(mapCenter.lat));
            params.set("lng", String(mapCenter.lng));
          }
          const res = await fetch(`/api/v2/places/search?${params.toString()}`);
          const data = (await res.json()) as { error?: string; results?: PlaceSearchResult[] };
          if (!res.ok) throw new Error(data.error ?? "Ricerca fallita");
          setResults(data.results ?? []);
          setOpen(true);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
          setResults([]);
        } finally {
          setBusy(false);
        }
      })();
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, mapCenter?.lat, mapCenter?.lng]);

  const pickPlace = (place: PlaceSearchResult) => {
    onSelect(place, "all");
    setOpen(false);
    setQuery(shortLabel(place.display_name));
  };

  const pickCategory = (kind: PoiKindMeta) => {
    onCategorySearch(kind);
    setOpen(false);
    setQuery(kind.label);
  };

  const hasDropdown =
    open &&
    query.trim().length >= 2 &&
    (categoryMatches.length > 0 || results.length > 0);

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
        Cerca luogo o categoria
      </label>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (query.trim().length >= 2) setOpen(true);
        }}
        placeholder="Bivacco, rifugio, ristorante, vetta, paese…"
        className="mt-1 w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2.5 py-2 text-sm"
        autoComplete="off"
      />
      {busy || poiBusy ? (
        <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">{poiBusy ? "Cerco POI…" : "Cerco…"}</p>
      ) : null}
      {err ? <p className="mt-1 text-[10px] text-red-400">{err}</p> : null}
      {!viewportReady && query.trim().length >= 2 && categoryMatches.length > 0 ? (
        <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
          Attendi il caricamento della mappa per cercare categorie nell&apos;area visibile.
        </p>
      ) : null}
      {hasDropdown ? (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] shadow-lg">
          {categoryMatches.length > 0 ? (
            <div>
              <p className="sticky top-0 border-b border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-surface)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--hmr-faint)]">
                Categorie · area visibile
              </p>
              <ul>
                {categoryMatches.map((k) => (
                  <li key={k.id}>
                    <button
                      type="button"
                      disabled={!viewportReady || poiBusy}
                      onClick={() => pickCategory(k)}
                      className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] hover:bg-[color:var(--hmr-elev)] disabled:opacity-50"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: k.color }}
                      />
                      <span>
                        <span className="font-medium">{k.label}</span>
                        <span className="ml-1 text-[color:var(--hmr-faint)]">nella mappa</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {results.length > 0 ? (
            <div>
              <p className="sticky top-0 border-b border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-surface)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--hmr-faint)]">
                Luoghi
              </p>
              <ul>
                {results.map((r, i) => (
                  <li key={`${r.lat}-${r.lng}-${i}`}>
                    <button
                      type="button"
                      onClick={() => pickPlace(r)}
                      className="w-full px-2.5 py-2 text-left text-[11px] hover:bg-[color:var(--hmr-elev)]"
                    >
                      <span className="font-medium">{shortLabel(r.display_name)}</span>
                      {r.type ? (
                        <span className="ml-1 text-[color:var(--hmr-faint)]">· {r.type}</span>
                      ) : null}
                      <span className="mt-0.5 block truncate text-[10px] text-[color:var(--hmr-muted)]">
                        {r.display_name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
