"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

type AlongItem = {
  id: string;
  name: string;
  kindLabel: string;
  grp: string;
  alongKm: number;
  distM: number;
  lat: number;
  lng: number;
};

type Props = {
  routeCoords: [number, number][] | null;
  onSelect: (item: AlongItem) => void;
};

export default function V2AlongRoutePanel({ routeCoords, onSelect }: Props) {
  const [items, setItems] = useState<AlongItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!routeCoords || routeCoords.length < 2) {
      setItems([]);
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        const data = await fetchJson<{ items: AlongItem[] }>("/api/v2/features/along", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates: routeCoords, maxDistM: 150 }),
        });
        setItems(data.items ?? []);
      } catch {
        setItems([]);
      } finally {
        setBusy(false);
      }
    })();
  }, [routeCoords]);

  if (!routeCoords || routeCoords.length < 2) return null;

  return (
    <section>
      {busy ? (
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-[color:var(--hmr-elev)]/70" />
          ))}
        </div>
      ) : null}
      {!busy && items.length === 0 ? (
        <p className="text-[12.5px] text-[color:var(--hmr-muted)]">Nessun elemento entro 150 m dal percorso.</p>
      ) : null}
      {!busy && items.length > 0 ? (
        <ol className="relative -mx-1">
          {items.slice(0, 40).map((it) => (
            <li key={`${it.id}-${it.alongKm}`}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left hover:bg-[color:var(--hmr-elev)]"
                onClick={() => onSelect(it)}
              >
                <span className="w-12 shrink-0 text-right text-[12px] font-bold tabular-nums text-[color:var(--hmr-accent)]">
                  {it.alongKm.toFixed(1)}
                  <span className="ml-0.5 text-[10px] font-semibold text-[color:var(--hmr-faint)]">km</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{it.name || it.kindLabel}</span>
                  <span className="block truncate text-[11.5px] text-[color:var(--hmr-faint)]">
                    {it.name ? `${it.kindLabel} · ` : ""}
                    {it.distM < 10 ? "sul percorso" : `a ${it.distM} m`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {items.length > 40 ? (
        <p className="mt-1 px-1 text-[11.5px] text-[color:var(--hmr-faint)]">+ altri {items.length - 40} elementi</p>
      ) : null}
    </section>
  );
}
