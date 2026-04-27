"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlanner } from "@/context/PlannerProvider";
import { bboxFromLngLatPositions, padBbox } from "@/lib/overpass";
import type { TrailServicePoi } from "@/lib/overpass";
import type { Position } from "geojson";

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

type Props = {
  onWaterForMap?: (pois: { lat: number; lng: number }[]) => void;
  onServicesForMap?: (pois: TrailServicePoi[]) => void;
};

export function OsmWaterNearby({ onWaterForMap, onServicesForMap }: Props) {
  const { stops, displayLine, activeItineraryId } = usePlanner();
  const [loading, setLoading] = useState(false);
  const [loadingSvc, setLoadingSvc] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [svcErr, setSvcErr] = useState<string | null>(null);
  const [waterNote, setWaterNote] = useState<string | null>(null);
  const [servicesNote, setServicesNote] = useState<string | null>(null);
  const [rows, setRows] = useState<{ name: string; kind: string; lat: number; lng: number }[]>([]);
  const [svcRows, setSvcRows] = useState<TrailServicePoi[]>([]);
  const [showServices, setShowServices] = useState(false);

  /** LineString del percorso: traccia disegnata o polilinea tra tappe ordinate. */
  const routeCoords = useMemo((): Position[] | null => {
    const coords = displayLine?.geometry?.coordinates as Position[] | undefined;
    if (coords && coords.length >= 2) return coords;
    const sorted = [...stops].sort((a, b) => a.order_index - b.order_index);
    if (sorted.length >= 2) {
      return sorted.map((s) => [s.lng, s.lat] as Position);
    }
    return null;
  }, [displayLine, stops]);

  const rawBox = useMemo(() => {
    const coords = displayLine?.geometry?.coordinates as Position[] | undefined;
    if (coords && coords.length >= 2) {
      const ll = coords.map((c) => [c[0], c[1]] as [number, number]);
      return bboxFromLngLatPositions(ll);
    }
    return bboxFromStops(stops);
  }, [displayLine, stops]);

  const searchBox = useMemo(() => {
    if (!rawBox) return null;
    return padBbox(rawBox.south, rawBox.west, rawBox.north, rawBox.east, 0.008);
  }, [rawBox]);

  const searchWater = useCallback(async () => {
    if (!routeCoords || routeCoords.length < 2) {
      setErr("Serve un percorso con almeno due punti (traccia o tappe).");
      setRows([]);
      onWaterForMap?.([]);
      return;
    }
    setLoading(true);
    setErr(null);
    setWaterNote(null);
    try {
      const res = await fetch("/api/osm/water", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: routeCoords, radiusMeters: 450 }),
      });
      const j = (await res.json()) as {
        pois?: { lat: number; lng: number; name: string | null; kind: string }[];
        error?: string;
        warning?: string;
        stale?: boolean;
      };
      if (!res.ok) {
        setErr(j.error ?? "Errore");
        setRows([]);
        onWaterForMap?.([]);
        return;
      }
      if (j.warning) {
        setWaterNote(j.stale ? `Lista da cache (Overpass non rispondeva): ${j.warning}` : j.warning);
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
      onWaterForMap?.(pois.map((p) => ({ lat: p.lat, lng: p.lng })));
    } catch {
      setErr("Rete non disponibile");
      setRows([]);
      onWaterForMap?.([]);
    } finally {
      setLoading(false);
    }
  }, [routeCoords, onWaterForMap]);

  useEffect(() => {
    setRows([]);
    setErr(null);
    setWaterNote(null);
    setSvcErr(null);
    onWaterForMap?.([]);
  }, [activeItineraryId, onWaterForMap]);

  useEffect(() => {
    if (!searchBox || !showServices) {
      setSvcRows([]);
      onServicesForMap?.([]);
      return;
    }
    if (!routeCoords || routeCoords.length < 2) {
      setSvcRows([]);
      onServicesForMap?.([]);
      return;
    }
    let cancelled = false;
    setLoadingSvc(true);
    setServicesNote(null);
    setSvcErr(null);
    void (async () => {
      try {
        const res = await fetch("/api/osm/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates: routeCoords, radiusMeters: 500 }),
        });
        const j = (await res.json()) as {
          pois?: TrailServicePoi[];
          error?: string;
          warning?: string;
          stale?: boolean;
        };
        if (cancelled) return;
        if (!res.ok) {
          setSvcErr(j.error ?? `Errore servizi OSM (${res.status})`);
          setSvcRows([]);
          onServicesForMap?.([]);
          return;
        }
        setSvcErr(null);
        if (j.warning) {
          setServicesNote(j.stale ? `Da cache (Overpass non rispondeva): ${j.warning}` : j.warning);
        }
        const pois = j.pois ?? [];
        setSvcRows(pois);
        onServicesForMap?.(pois);
      } catch {
        if (!cancelled) {
          setSvcErr("Rete non disponibile (servizi)");
          setSvcRows([]);
          onServicesForMap?.([]);
        }
      } finally {
        if (!cancelled) setLoadingSvc(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchBox, showServices, routeCoords, onServicesForMap]);

  useEffect(() => {
    setSvcRows([]);
    setServicesNote(null);
    onServicesForMap?.([]);
  }, [activeItineraryId, onServicesForMap]);

  const canQueryRoute = routeCoords != null && routeCoords.length >= 2;

  return (
    <div className="rounded border border-zinc-800/60 bg-zinc-950/30 px-2 py-1.5 text-[10px] text-zinc-500">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-400">Acqua lungo il percorso (OSM)</span>
        <button
          type="button"
          disabled={loading || !canQueryRoute}
          title={
            canQueryRoute
              ? "Cerca fontane vicino alla traccia (corridoio), non su tutta l’area"
              : "Serve una linea con almeno due punti"
          }
          className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
          onClick={() => void searchWater()}
        >
          {loading ? "…" : "Cerca"}
        </button>
      </div>
      <p className="mb-1 text-[9px] leading-snug text-zinc-600">
        Solo quando premi «Cerca»: interrogazione lungo la linea del percorso (non tutta la mappa).
      </p>
      <label className="mb-1 flex cursor-pointer items-center gap-2 text-[10px] text-zinc-400">
        <input
          type="checkbox"
          className="rounded border-zinc-600"
          checked={showServices}
          onChange={(e) => setShowServices(e.target.checked)}
          disabled={!canQueryRoute}
        />
        Rifugi, bivacchi, ristoranti {loadingSvc ? "…" : ""}
      </label>
      {err && <p className="text-amber-400/90">{err}</p>}
      {waterNote && !err && <p className="text-zinc-500">{waterNote}</p>}
      {servicesNote && !err && showServices ? <p className="text-zinc-500">{servicesNote}</p> : null}
      {showServices && svcErr ? <p className="text-amber-400/90">{svcErr}</p> : null}
      {rows.length > 0 && (
        <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-zinc-400">
          {rows.slice(0, 20).map((r, i) => (
            <li key={`w-${r.lat}-${r.lng}-${i}`} className="truncate" title={`${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`}>
              · {r.name} <span className="text-zinc-600">({r.kind})</span>
            </li>
          ))}
        </ul>
      )}
      {showServices && svcRows.length > 0 ? (
        <ul className="mt-1 max-h-20 space-y-0.5 overflow-y-auto border-t border-zinc-800/60 pt-1 text-zinc-400">
          {svcRows.slice(0, 15).map((r, i) => (
            <li key={`s-${r.lat}-${r.lng}-${i}`} className="truncate">
              ◆ {r.name ?? r.kind} <span className="text-zinc-600">({r.kind})</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
