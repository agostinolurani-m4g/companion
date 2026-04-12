"use client";

import { useCallback, useState } from "react";
import { usePlanner } from "@/context/PlannerProvider";

function bboxFromStops(
  stops: { lat: number; lng: number }[]
): { south: number; west: number; north: number; east: number } | null {
  if (stops.length === 0) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const s of stops) {
    south = Math.min(south, s.lat);
    north = Math.max(north, s.lat);
    west = Math.min(west, s.lng);
    east = Math.max(east, s.lng);
  }
  if (!Number.isFinite(south)) return null;
  return { south, west, north, east };
}

export function OsmWaterNearby() {
  const { stops } = usePlanner();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<{ name: string; kind: string; lat: number; lng: number }[]>([]);

  const search = useCallback(async () => {
    const box = bboxFromStops(stops);
    if (!box) {
      setErr("Aggiungi almeno una tappa sulla mappa.");
      setRows([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/osm/water", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(box),
      });
      const j = (await res.json()) as {
        pois?: { lat: number; lng: number; name: string | null; kind: string }[];
        error?: string;
      };
      if (!res.ok) {
        setErr(j.error ?? "Errore");
        setRows([]);
        return;
      }
      const pois = j.pois ?? [];
      setRows(
        pois.map((p) => ({
          name: p.name ?? "(senza nome)",
          kind: p.kind,
          lat: p.lat,
          lng: p.lng,
        }))
      );
    } catch {
      setErr("Rete non disponibile");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [stops]);

  return (
    <div className="rounded border border-zinc-800/60 bg-zinc-950/30 px-2 py-1.5 text-[10px] text-zinc-500">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-400">Fontane / acqua (OSM)</span>
        <button
          type="button"
          disabled={loading || stops.length === 0}
          className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
          onClick={() => void search()}
        >
          {loading ? "…" : "Cerca nell’area tappe"}
        </button>
      </div>
      {err && <p className="text-amber-400/90">{err}</p>}
      {rows.length > 0 && (
        <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-zinc-400">
          {rows.slice(0, 25).map((r, i) => (
            <li key={`${r.lat}-${r.lng}-${i}`} className="truncate" title={`${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`}>
              · {r.name} <span className="text-zinc-600">({r.kind})</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[9px] text-zinc-600">
        Dati OpenStreetMap (non Strava/Komoot). Segmenti Strava e foto Komoot richiedono API dedicate e termini d’uso
        separati.
      </p>
    </div>
  );
}
