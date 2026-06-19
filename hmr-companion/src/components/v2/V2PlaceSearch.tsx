"use client";

import { useEffect, useRef, useState } from "react";
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
  mapCenter?: { lat: number; lng: number };
};

const KINDS: { id: PlaceSearchKind; label: string }[] = [
  { id: "all", label: "Tutti" },
  { id: "peak", label: "Vette" },
  { id: "town", label: "Paesi" },
  { id: "water", label: "Acqua" },
  { id: "hut", label: "Rifugi" },
  { id: "restaurant", label: "Ristoranti" },
];

function shortLabel(name: string): string {
  const parts = name.split(",").map((s) => s.trim());
  return parts.slice(0, 2).join(", ");
}

export default function V2PlaceSearch({ onSelect, mapCenter }: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<PlaceSearchKind>("all");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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
          const params = new URLSearchParams({ q, kind });
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
  }, [query, kind, mapCenter?.lat, mapCenter?.lng]);

  const pick = (place: PlaceSearchResult) => {
    onSelect(place, kind);
    setOpen(false);
    setQuery(shortLabel(place.display_name));
  };

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
        Cerca luogo
      </label>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Vetta, paese, rifugio, fiume…"
        className="mt-1 w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2.5 py-2 text-sm"
        autoComplete="off"
      />
      <div className="mt-1 flex flex-wrap gap-1">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={
              kind === k.id
                ? "rounded-md bg-[color:var(--hmr-accent)]/20 px-1.5 py-0.5 text-[10px] text-[color:var(--hmr-accent)]"
                : "rounded-md border border-[color:var(--hmr-border)]/70 px-1.5 py-0.5 text-[10px] text-[color:var(--hmr-muted)]"
            }
          >
            {k.label}
          </button>
        ))}
      </div>
      {busy ? <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">Cerco…</p> : null}
      {err ? <p className="mt-1 text-[10px] text-red-400">{err}</p> : null}
      {open && results.length > 0 ? (
        <ul className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] shadow-lg">
          {results.map((r, i) => (
            <li key={`${r.lat}-${r.lng}-${i}`}>
              <button
                type="button"
                onClick={() => pick(r)}
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
      ) : null}
    </div>
  );
}
