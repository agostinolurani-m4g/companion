"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PoiKindMeta } from "@/lib/categories";
import { matchSearchKinds } from "@/lib/categories";
import type { PlaceSearchKind } from "@/lib/geocoding";
import Icon from "@/components/v2/ui/Icon";

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
  const [activeIdx, setActiveIdx] = useState(-1);
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
          const localRes = await fetch(`/api/v2/features/search?q=${encodeURIComponent(q)}`);
          const localData = (await localRes.json()) as {
            results?: Array<{
              id: string;
              name: string;
              kindLabel: string;
              lat: number;
              lng: number;
            }>;
          };
          const localHits: PlaceSearchResult[] = (localData.results ?? []).map((r) => ({
            lat: r.lat,
            lng: r.lng,
            display_name: `${r.name} · ${r.kindLabel}`,
            type: "outdoor",
            category: r.id,
          }));

          const params = new URLSearchParams({ q, kind: "all" });
          if (mapCenter) {
            params.set("lat", String(mapCenter.lat));
            params.set("lng", String(mapCenter.lng));
          }
          const res = await fetch(`/api/v2/places/search?${params.toString()}`);
          const data = (await res.json()) as { error?: string; results?: PlaceSearchResult[] };
          if (!res.ok) throw new Error(data.error ?? "Ricerca fallita");
          const merged = [...localHits, ...(data.results ?? [])].slice(0, 12);
          setResults(merged);
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

  const flat: Array<{ kind: "cat"; k: PoiKindMeta } | { kind: "place"; r: PlaceSearchResult }> = hasDropdown
    ? [
        ...categoryMatches.map((k) => ({ kind: "cat" as const, k })),
        ...results.map((r) => ({ kind: "place" as const, r })),
      ]
    : [];

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hasDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const it = flat[activeIdx >= 0 ? activeIdx : 0];
      if (!it) return;
      e.preventDefault();
      if (it.kind === "cat") {
        if (viewportReady && !poiBusy) pickCategory(it.k);
      } else pickPlace(it.r);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--hmr-faint)]"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => {
            if (query.trim().length >= 2) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Cerca luogo, rifugio, vetta, categoria…"
          aria-label="Cerca luogo o categoria"
          className="ui-input !min-h-[44px] !rounded-xl !pl-10 !pr-10 [&::-webkit-search-cancel-button]:hidden"
          autoComplete="off"
        />
        {busy || poiBusy ? (
          <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-[color:var(--hmr-accent)]/25 border-t-[color:var(--hmr-accent)]" />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[color:var(--hmr-faint)] hover:bg-[color:var(--hmr-elev)] hover:text-[color:var(--hmr-text)]"
            aria-label="Cancella ricerca"
          >
            <Icon name="x" size={15} />
          </button>
        ) : null}
      </div>
      {err ? <p className="mt-1 text-[11px] text-[color:var(--hmr-danger)]">{err}</p> : null}
      {!viewportReady && query.trim().length >= 2 && categoryMatches.length > 0 ? (
        <p className="mt-1 text-[11px] text-[color:var(--hmr-muted)]">
          Attendi il caricamento della mappa per cercare categorie nell&apos;area visibile.
        </p>
      ) : null}
      {hasDropdown ? (
        <div className="ui-scroll absolute left-0 right-0 z-40 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-surface)] py-1 shadow-[var(--hmr-shadow)]">
          {categoryMatches.length > 0 ? (
            <div>
              <p className="ui-eyebrow px-3 pb-1 pt-1.5">Categorie nell&apos;area visibile</p>
              <ul>
                {categoryMatches.map((k, idx) => {
                  return (
                    <li key={k.id}>
                      <button
                        type="button"
                        disabled={!viewportReady || poiBusy}
                        onClick={() => pickCategory(k)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] disabled:opacity-50 ${
                          activeIdx === idx ? "bg-[color:var(--hmr-elev)]" : ""
                        }`}
                      >
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                          style={{ background: `${k.color}26`, color: k.color }}
                        >
                          <Icon name="search" size={14} strokeWidth={2.2} />
                        </span>
                        <span className="font-semibold">{k.label}</span>
                        <span className="text-[color:var(--hmr-faint)]">nella mappa</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {results.length > 0 ? (
            <div>
              <p className="ui-eyebrow px-3 pb-1 pt-1.5">Luoghi</p>
              <ul>
                {results.map((r, i) => {
                  const idx = categoryMatches.length + i;
                  const outdoor = r.type === "outdoor";
                  return (
                    <li key={`${r.lat}-${r.lng}-${i}`}>
                      <button
                        type="button"
                        onClick={() => pickPlace(r)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                          activeIdx === idx ? "bg-[color:var(--hmr-elev)]" : ""
                        }`}
                      >
                        <span
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                            outdoor
                              ? "bg-[color:var(--hmr-accent-dim)] text-[color:var(--hmr-accent)]"
                              : "bg-[color:var(--hmr-elev)] text-[color:var(--hmr-muted)]"
                          }`}
                        >
                          <Icon name={outdoor ? "mountain" : "pin"} size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">{shortLabel(r.display_name)}</span>
                          <span className="block truncate text-[11.5px] text-[color:var(--hmr-muted)]">
                            {r.type && !outdoor ? `${r.type} · ` : ""}
                            {r.display_name}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
