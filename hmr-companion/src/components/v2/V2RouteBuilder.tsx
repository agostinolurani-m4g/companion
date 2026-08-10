"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import V2Nav from "@/components/v2/V2Nav";
import V2PlanMap, { type V2MapClickTarget, type V2Waypoint } from "@/components/v2/V2PlanMap";
import V2PoiBanner from "@/components/v2/V2PoiBanner";
import V2WaypointList from "@/components/v2/V2WaypointList";
import V2PlaceSearch, { type PlaceSearchResult } from "@/components/v2/V2PlaceSearch";
import ElevationChart from "@/components/ElevationChart";
import type { PoiCategory } from "@/lib/db";
import type { UserRouteActivity, UserRouteVisibility } from "@/lib/db";
import {
  CATEGORY_ORDER,
  poiMatchesAnyKind,
  poiMatchesKind,
  resolvePoiKind,
  SEARCH_KINDS,
  VIEWPORT_SEARCH_KINDS,
  type PoiKind,
  type PoiKindMeta,
} from "@/lib/categories";
import type { V2SearchPoi } from "@/app/api/v2/pois/search/route";
import { geocodeToPoi, type PlaceSearchKind } from "@/lib/geocoding";
import { DEFAULT_MAP_VIEW_CENTER } from "@/lib/map-defaults";
import type { ViewBbox } from "@/lib/overpass";
import { sampleElevationsForLine } from "@/lib/elevation";
import type { StoredCoord } from "@/lib/track-coords";
import { elevationGainLossSmoothed, smoothElevationProfile } from "@/lib/track-geometry";
import type { RouteTech } from "@/lib/ors-route-tech";
import { formatSurfacePctSummary, formatTerrainIt, SURFACE_COLORS } from "@/lib/ors-route-tech";
import type { TrackSurfaceKind } from "@/lib/surface-osm";

type Props = {
  isAdmin?: boolean;
  username?: string;
};

type MapAction =
  | { kind: "new_point"; lng: number; lat: number; label?: string }
  | { kind: "waypoint"; index: number; lng: number; lat: number }
  | { kind: "poi"; poi: V2SearchPoi };

const ACTIVITY_LABELS: Record<UserRouteActivity, string> = {
  road: "Bici da strada",
  mtb: "MTB",
  hike: "Escursione",
  gravel: "Gravel",
  ski: "Scialpinismo",
};

const PLAN_ACTIVITIES: UserRouteActivity[] = ["road", "mtb", "hike", "gravel"];

const POI_RADIUS_PRESETS: PoiKindMeta[] = SEARCH_KINDS;

const POI_SEARCH_RADIUS_M = 3000;

function sqDistToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const ddx = px - ax;
    const ddy = py - ay;
    return ddx * ddx + ddy * ddy;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const ddx = px - (ax + t * dx);
  const ddy = py - (ay + t * dy);
  return ddx * ddx + ddy * ddy;
}

/** Indice dove inserire il nuovo punto (tra wp[i-1] e wp[i]). */
function findInsertIndex(wps: V2Waypoint[], lng: number, lat: number): number {
  if (wps.length < 2) return wps.length;

  let bestIdx = 1;
  let bestDist = Infinity;
  for (let i = 0; i < wps.length - 1; i++) {
    const d = sqDistToSegment(lng, lat, wps[i].lng, wps[i].lat, wps[i + 1].lng, wps[i + 1].lat);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i + 1;
    }
  }
  return bestIdx;
}

/** Aggiunge un nuovo punto di arrivo; il precedente resta come tappa intermedia. */
function applyArrivalPoint(wps: V2Waypoint[], lng: number, lat: number, label?: string): V2Waypoint[] {
  const p: V2Waypoint = { lng, lat, label };
  return [...wps, p];
}

/** Inserisce il punto nel segmento più vicino del percorso. */
function applyInsertInRoute(
  wps: V2Waypoint[],
  lng: number,
  lat: number,
  label: string | undefined
): V2Waypoint[] {
  const p: V2Waypoint = { lng, lat, label };
  if (wps.length === 0) return [p];
  if (wps.length === 1) return [...wps, p];
  const idx = findInsertIndex(wps, lng, lat);
  return [...wps.slice(0, idx), p, ...wps.slice(idx)];
}

export default function V2RouteBuilder({ isAdmin = false, username }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeId = searchParams.get("route");

  const [activity, setActivity] = useState<UserRouteActivity>("hike");
  const [waypoints, setWaypoints] = useState<V2Waypoint[]>([]);
  const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
  const [routeTech, setRouteTech] = useState<RouteTech | null>(null);
  const [lengthKm, setLengthKm] = useState(0);
  const [elevGainM, setElevGainM] = useState(0);
  const [elevLossM, setElevLossM] = useState(0);
  const [pois, setPois] = useState<V2SearchPoi[]>([]);
  const [poiSearchCenter, setPoiSearchCenter] = useState<{ lng: number; lat: number } | null>(null);
  const [poiSearchBbox, setPoiSearchBbox] = useState<ViewBbox | null>(null);
  const [mapViewport, setMapViewport] = useState<ViewBbox | null>(null);
  const [routing, setRouting] = useState(false);
  const [poiBusy, setPoiBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [outingBusy, setOutingBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<UserRouteVisibility>("private");
  const [mapAction, setMapAction] = useState<MapAction | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lng: number; lat: number; zoom?: number } | undefined>(
    DEFAULT_MAP_VIEW_CENTER
  );
  const [profileCoords, setProfileCoords] = useState<StoredCoord[]>([]);
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(null);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; key: number } | null>(null);
  const flyKeyRef = useRef(0);
  const [selectedViewportKinds, setSelectedViewportKinds] = useState<Set<PoiKind>>(
    () => new Set(VIEWPORT_SEARCH_KINDS.map((k) => k.id))
  );

  const routeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRoute = useCallback(async (wps: V2Waypoint[], act: UserRouteActivity) => {
    if (wps.length < 2) {
      setRouteCoords(null);
      setRouteTech(null);
      setLengthKm(0);
      setElevGainM(0);
      setElevLossM(0);
      return;
    }
    setRouting(true);
    setErr(null);
    try {
      const coordinates = wps.map((w) => [w.lng, w.lat] as [number, number]);
      const res = await fetch("/api/v2/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates, activity: act }),
      });
      const data = (await res.json()) as {
        error?: string;
        feature?: GeoJSON.Feature<GeoJSON.LineString>;
        length_km?: number;
        tech?: RouteTech | null;
      };
      if (!res.ok || !data.feature) throw new Error(data.error ?? "Routing fallito");
      setRouteCoords(data.feature.geometry.coordinates as [number, number][]);
      setRouteTech(data.tech ?? null);
      setLengthKm(data.length_km ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRouteCoords(null);
      setRouteTech(null);
      setLengthKm(0);
      setElevGainM(0);
      setElevLossM(0);
    } finally {
      setRouting(false);
    }
  }, []);

  useEffect(() => {
    if (routeTimer.current) clearTimeout(routeTimer.current);
    routeTimer.current = setTimeout(() => {
      void fetchRoute(waypoints, activity);
    }, 400);
    return () => {
      if (routeTimer.current) clearTimeout(routeTimer.current);
    };
  }, [waypoints, activity, fetchRoute]);

  useEffect(() => {
    if (!routeCoords || routeCoords.length < 2) {
      setProfileCoords([]);
      setElevGainM(0);
      setElevLossM(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      const positions = routeCoords.map((c) => [c[0], c[1]] as [number, number]);
      const { distanceKm, elevationM, sampled } = await sampleElevationsForLine(positions);
      if (cancelled) return;
      const { gain, loss } = elevationGainLossSmoothed(elevationM);
      setElevGainM(gain);
      setElevLossM(loss);
      const displayWindow = Math.max(3, Math.min(7, Math.round(elevationM.length / 20)));
      const smoothed = smoothElevationProfile(elevationM, displayWindow);
      setProfileCoords(
        sampled.map(
          (p, i) => [p[0], p[1], smoothed[i] ?? null, distanceKm[i] ?? 0] as StoredCoord,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [routeCoords]);

  useEffect(() => {
    if (!routeId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/v2/routes/${encodeURIComponent(routeId)}`);
        const data = (await res.json()) as {
          error?: string;
          route?: {
            name: string;
            activity: UserRouteActivity;
            waypoints: [number, number][];
            geojson: GeoJSON.Feature<GeoJSON.LineString>;
            visibility: UserRouteVisibility;
            length_km: number;
          };
        };
        if (!res.ok || !data.route) throw new Error(data.error ?? "Caricamento fallito");
        const r = data.route;
        setName(r.name);
        setActivity(r.activity);
        setVisibility(r.visibility);
        setWaypoints(r.waypoints.map(([lng, lat]) => ({ lng, lat })));
        setRouteCoords(r.geojson.geometry.coordinates as [number, number][]);
        setLengthKm(r.length_km);
        const first = r.waypoints[0];
        if (first) setMapCenter({ lng: first[0], lat: first[1], zoom: 12 });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [routeId]);

  const onMapInteraction = useCallback((target: V2MapClickTarget) => {
    if (target.kind === "map") {
      setMapAction({ kind: "new_point", lng: target.lng, lat: target.lat });
      return;
    }
    if (target.kind === "waypoint") {
      setMapAction({
        kind: "waypoint",
        index: target.index,
        lng: target.lng,
        lat: target.lat,
      });
      return;
    }
    setMapAction({ kind: "poi", poi: target.poi });
  }, []);

  const dismissAction = () => setMapAction(null);

  const insertInRoute = (lng: number, lat: number, label?: string) => {
    setWaypoints((wps) => applyInsertInRoute(wps, lng, lat, label));
    dismissAction();
  };

  const setNewDestination = (lng: number, lat: number, label?: string) => {
    setWaypoints((wps) => applyArrivalPoint(wps, lng, lat, label));
    dismissAction();
  };

  const removeWaypoint = (index: number) => {
    setWaypoints((wps) => wps.filter((_, i) => i !== index));
    setSelectedWaypointIndex(null);
    dismissAction();
  };

  const moveWaypoint = useCallback((index: number, lng: number, lat: number) => {
    setWaypoints((wps) => wps.map((w, i) => (i === index ? { ...w, lng, lat } : w)));
  }, []);

  const reorderWaypoints = (next: V2Waypoint[]) => {
    setWaypoints(next);
    setSelectedWaypointIndex(null);
  };

  const onPlaceSelect = (place: PlaceSearchResult, searchKind: PlaceSearchKind) => {
    const poi: V2SearchPoi = geocodeToPoi(place, searchKind);
    setPois((prev) => {
      const idx = prev.findIndex((p) => p.id === poi.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = poi;
        return next;
      }
      return [...prev, poi];
    });
    flyKeyRef.current += 1;
    setFlyTo({ lng: place.lng, lat: place.lat, zoom: 14, key: flyKeyRef.current });
    setMapAction({ kind: "poi", poi });
    setSelectedWaypointIndex(null);
    setErr(null);
  };

  const mapViewCenter = useMemo(() => {
    if (waypoints.length > 0) {
      const w = waypoints[waypoints.length - 1];
      return { lat: w.lat, lng: w.lng };
    }
    return mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : undefined;
  }, [waypoints, mapCenter]);

  const searchPoisAtByKind = async (lng: number, lat: number, kind: PoiKindMeta) => {
    setPoiBusy(true);
    setErr(null);
    setPoiSearchBbox(null);
    setPoiSearchCenter({ lng, lat });
    try {
      const res = await fetch("/api/v2/pois/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat,
          lng,
          radiusM: POI_SEARCH_RADIUS_M,
          categories: [kind.category],
          refresh: false,
        }),
      });
      const data = (await res.json()) as { error?: string; pois?: V2SearchPoi[]; count?: number };
      if (!res.ok) throw new Error(data.error ?? "Ricerca POI fallita");
      const found = (data.pois ?? []).filter((p) => poiMatchesKind(p.category, p.sub_kind, kind));
      setPois(found);
      if (found.length === 0) {
        setErr(`Nessun ${kind.label.toLowerCase()} in un raggio di 3 km. Prova un'altra zona.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPois([]);
    } finally {
      setPoiBusy(false);
    }
  };

  const searchPoisAt = async (lng: number, lat: number, categories: PoiCategory[]) => {
    setPoiBusy(true);
    setErr(null);
    setPoiSearchBbox(null);
    setPoiSearchCenter({ lng, lat });
    try {
      const res = await fetch("/api/v2/pois/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, radiusM: POI_SEARCH_RADIUS_M, categories, refresh: false }),
      });
      const data = (await res.json()) as { error?: string; pois?: V2SearchPoi[]; count?: number };
      if (!res.ok) throw new Error(data.error ?? "Ricerca POI fallita");
      const found = data.pois ?? [];
      setPois(found);
      if (found.length === 0) {
        setErr("Nessun POI in un raggio di 3 km da questo punto. Prova un'altra zona o categoria.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPois([]);
    } finally {
      setPoiBusy(false);
    }
  };

  const searchPoisInViewportByKind = async (kind: PoiKindMeta) => {
    await searchPoisInViewport([kind]);
  };

  const searchPoisInViewport = async (kinds: PoiKindMeta[]) => {
    if (!mapViewport) {
      setErr("Attendi il caricamento della mappa.");
      return;
    }
    if (kinds.length === 0) {
      setErr("Seleziona almeno una categoria.");
      return;
    }
    setPoiBusy(true);
    setErr(null);
    setPoiSearchCenter(null);
    setPoiSearchBbox(mapViewport);
    const categories = [...new Set(kinds.map((k) => k.category))];
    try {
      const res = await fetch("/api/v2/pois/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bbox: mapViewport, categories, refresh: false }),
      });
      const data = (await res.json()) as { error?: string; pois?: V2SearchPoi[]; count?: number };
      if (!res.ok) throw new Error(data.error ?? "Ricerca POI fallita");
      const found = (data.pois ?? []).filter((p) => poiMatchesAnyKind(p.category, p.sub_kind, kinds));
      setPois(found);
      if (found.length === 0) {
        const labels = kinds.map((k) => k.label.toLowerCase()).join(", ");
        setErr(`Nessun risultato (${labels}) nell'area visibile. Prova ad ingrandire o spostare la mappa.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPois([]);
    } finally {
      setPoiBusy(false);
    }
  };

  const toggleViewportKind = (id: PoiKind) => {
    setSelectedViewportKinds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runViewportSearch = () => {
    const kinds = VIEWPORT_SEARCH_KINDS.filter((k) => selectedViewportKinds.has(k.id));
    void searchPoisInViewport(kinds);
  };

  const searchPoisNearby = async (lng: number, lat: number) => {
    dismissAction();
    await searchPoisAt(lng, lat, [...CATEGORY_ORDER]);
  };

  const clearPois = () => {
    setPois([]);
    setPoiSearchCenter(null);
    setPoiSearchBbox(null);
    if (mapAction?.kind === "poi") setMapAction(null);
  };

  const onViewportChange = useCallback((bbox: ViewBbox) => {
    setMapViewport(bbox);
  }, []);

  const saveRoute = async () => {
    if (!routeCoords || routeCoords.length < 2) {
      setErr("Serve almeno 2 waypoint con percorso calcolato");
      return;
    }
    setSaveBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/v2/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Percorso senza nome",
          activity,
          visibility,
          length_km: lengthKm,
          elev_gain_m: elevGainM,
          elev_loss_m: elevLossM,
          waypoints: waypoints.map((w) => [w.lng, w.lat]),
          geojson: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: routeCoords },
          },
        }),
      });
      const data = (await res.json()) as { error?: string; id?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Salvataggio fallito");
      router.push(`/v2/me`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const registerOuting = async () => {
    if (!routeId) return;
    setOutingBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/v2/outings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route_id: routeId,
          title: name.trim() || "Gita",
          outing_date: new Date().toISOString().slice(0, 10),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Registrazione gita fallita");
      router.push("/v2/me");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOutingBusy(false);
    }
  };

  const stats = useMemo(
    () => ({ waypoints: waypoints.length, km: lengthKm, elevGainM, elevLossM }),
    [waypoints.length, lengthKm, elevGainM, elevLossM],
  );

  const pendingPoint =
    mapAction?.kind === "new_point"
      ? { lng: mapAction.lng, lat: mapAction.lat }
      : null;

  const insertPreview = useMemo(() => {
    if (!mapAction || mapAction.kind === "waypoint") return null;
    const lng = mapAction.kind === "poi" ? mapAction.poi.lng : mapAction.lng;
    const lat = mapAction.kind === "poi" ? mapAction.poi.lat : mapAction.lat;
    if (waypoints.length < 2) return null;
    const idx = findInsertIndex(waypoints, lng, lat);
    return { after: idx - 1, before: idx, insertAt: idx };
  }, [mapAction, waypoints]);

  const actionCenter =
    mapAction?.kind === "new_point" || mapAction?.kind === "waypoint"
      ? { lng: mapAction.lng, lat: mapAction.lat }
      : mapAction?.kind === "poi"
        ? { lng: mapAction.poi.lng, lat: mapAction.poi.lat }
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hmr-panel z-10 flex max-h-[45vh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-[color:var(--hmr-border)]/60 p-3 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          <div>
            <h1 className="text-base font-semibold">Pianifica percorso</h1>
            <p className="mt-0.5 text-xs text-[color:var(--hmr-muted)]">
              Trascina tappe in elenco o sulla mappa. Arrivo = nuova tappa finale.
            </p>
          </div>

          <V2PlaceSearch
            onSelect={onPlaceSelect}
            onCategorySearch={(kind) => void searchPoisInViewportByKind(kind)}
            mapCenter={mapViewCenter}
            viewportReady={!!mapViewport}
            poiBusy={poiBusy}
          />

          <section>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
              Tappe ({waypoints.length})
            </p>
            <V2WaypointList
              waypoints={waypoints}
              onReorder={reorderWaypoints}
              onRemove={removeWaypoint}
              onSelect={(i) => {
                setSelectedWaypointIndex(i);
                const wp = waypoints[i];
                if (wp) setMapAction({ kind: "waypoint", index: i, lng: wp.lng, lat: wp.lat });
              }}
              selectedIndex={selectedWaypointIndex}
            />
          </section>

          <div className="flex flex-wrap gap-1">
            {PLAN_ACTIVITIES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setActivity(a)}
                className={
                  activity === a
                    ? "rounded-lg bg-[color:var(--hmr-accent)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                    : "rounded-lg border border-[color:var(--hmr-border)] px-2.5 py-1.5 text-xs text-[color:var(--hmr-muted)]"
                }
              >
                {ACTIVITY_LABELS[a]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">Tappe</div>
              <div className="font-medium">{stats.waypoints}</div>
            </div>
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">Km</div>
              <div className="font-medium">{stats.km.toFixed(1)}</div>
            </div>
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">D+</div>
              <div className="font-medium">{Math.round(stats.elevGainM)}</div>
            </div>
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">D-</div>
              <div className="font-medium">{Math.round(stats.elevLossM)}</div>
            </div>
          </div>

          {routeTech?.summary ? (
            <section className="rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)] p-2.5 text-xs">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
                Terreno sul percorso
              </p>
              <p className="mt-1 text-[color:var(--hmr-text)]">
                {formatSurfacePctSummary(routeTech.summary.surface_pct)}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-[color:var(--hmr-muted)]">
                {routeTech.summary.max_difficulty ? (
                  <span>Difficoltà max: {routeTech.summary.max_difficulty}</span>
                ) : null}
                {routeTech.summary.max_steepness ? (
                  <span>Ripidità max: {routeTech.summary.max_steepness}</span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["asphalt", "gravel", "single", "unknown"] as TrackSurfaceKind[]).map((k) => {
                  const pct = routeTech.summary.surface_pct[k];
                  if (pct < 1) return null;
                  return (
                    <span key={k} className="inline-flex items-center gap-1 text-[10px]">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: SURFACE_COLORS[k] }}
                      />
                      {formatTerrainIt(k)} {pct.toFixed(0)}%
                    </span>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setWaypoints((wps) => wps.slice(0, -1))}
              disabled={waypoints.length === 0}
              className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Annulla ultima tappa
            </button>
            <button
              type="button"
              onClick={() => {
                setWaypoints([]);
                setRouteCoords(null);
                setRouteTech(null);
                setLengthKm(0);
                setElevGainM(0);
                setElevLossM(0);
                setPois([]);
                setPoiSearchCenter(null);
                setPoiSearchBbox(null);
                setMapAction(null);
              }}
              disabled={waypoints.length === 0 && pois.length === 0}
              className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 disabled:opacity-40"
            >
              Pulisci tutto
            </button>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--hmr-faint)]">
                Nella mappa visibile
              </p>
              {poiBusy ? <span className="text-[10px] text-[color:var(--hmr-muted)]">Cerco…</span> : null}
            </div>
            <div className="flex flex-wrap gap-1">
              {VIEWPORT_SEARCH_KINDS.map((k) => {
                const on = selectedViewportKinds.has(k.id);
                return (
                  <button
                    key={k.id}
                    type="button"
                    disabled={poiBusy}
                    onClick={() => toggleViewportKind(k.id)}
                    className={
                      on
                        ? "rounded-lg border px-2 py-1 text-[11px] disabled:opacity-50"
                        : "rounded-lg border border-[color:var(--hmr-border)] px-2 py-1 text-[11px] text-[color:var(--hmr-muted)] disabled:opacity-50"
                    }
                    style={
                      on
                        ? { borderColor: `${k.color}88`, background: `${k.color}22`, color: k.color }
                        : undefined
                    }
                  >
                    {k.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={poiBusy || !mapViewport || selectedViewportKinds.size === 0}
              onClick={runViewportSearch}
              className="mt-1.5 w-full rounded-lg border border-orange-500/35 bg-orange-500/10 px-2 py-1.5 text-[11px] font-medium text-orange-200/90 hover:bg-orange-500/15 disabled:opacity-50"
            >
              Cerca nell&apos;area
            </button>
            <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
              Sposta e ingrandisci la mappa, scegli le categorie, poi cerca (max ~55 km di lato)
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--hmr-faint)]">
                Categorie POI {actionCenter ? "(sul punto selezionato)" : "(ultima tappa o Chiavenna)"}
              </p>
              {poiBusy ? <span className="text-[10px] text-[color:var(--hmr-muted)]">Cerco…</span> : null}
              {pois.length > 0 || poiSearchCenter || poiSearchBbox ? (
                <button
                  type="button"
                  onClick={clearPois}
                  className="text-[10px] text-orange-300/90 underline"
                >
                  Nascondi POI
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1">
              {POI_RADIUS_PRESETS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  disabled={poiBusy}
                  onClick={() => {
                    const center =
                      actionCenter ??
                      (waypoints.length > 0
                        ? waypoints[waypoints.length - 1]
                        : DEFAULT_MAP_VIEW_CENTER);
                    void searchPoisAtByKind(center.lng, center.lat, k);
                  }}
                  className="rounded-lg border px-2 py-1 text-[11px] disabled:opacity-50"
                  style={{
                    borderColor: `${k.color}55`,
                    color: k.color,
                  }}
                >
                  {k.label}
                </button>
              ))}
              <button
                type="button"
                disabled={poiBusy}
                onClick={() => {
                  const center =
                    actionCenter ??
                    (waypoints.length > 0
                      ? waypoints[waypoints.length - 1]
                      : DEFAULT_MAP_VIEW_CENTER);
                  void searchPoisAt(center.lng, center.lat, [...CATEGORY_ORDER]);
                }}
                className="rounded-lg border border-[color:var(--hmr-border)] px-2 py-1 text-[11px] text-[color:var(--hmr-muted)] hover:text-[color:var(--hmr-text)] disabled:opacity-50"
              >
                Tutti
              </button>
            </div>
            {poiSearchBbox ? (
              <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
                Rettangolo arancione = area cercata · {pois.length} POI · nuova ricerca sostituisce i risultati
              </p>
            ) : poiSearchCenter ? (
              <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
                Cerchio arancione = raggio 3 km · {pois.length} POI
              </p>
            ) : (
              <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
                Oppure scrivi nella barra (es. bivacco) e cerca nell&apos;area visibile
              </p>
            )}
          </div>

          {pois.length > 0 ? (
            <ul className="max-h-36 space-y-1 overflow-y-auto text-[11px]">
              {pois.slice(0, 12).map((p) => {
                const kindMeta = resolvePoiKind(p.category, p.sub_kind);
                return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setMapAction({ kind: "poi", poi: p })}
                    className="w-full rounded-lg px-2 py-1 text-left hover:bg-[color:var(--hmr-elev)]"
                  >
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-full"
                      style={{ background: kindMeta.color }}
                    />
                    <span className="text-[color:var(--hmr-faint)]">{kindMeta.label} · </span>
                    {p.name ?? p.sub_kind}
                  </button>
                </li>
                );
              })}
              {pois.length > 12 ? (
                <li className="px-2 text-[color:var(--hmr-faint)]">+ altri {pois.length - 12} POI sulla mappa</li>
              ) : null}
            </ul>
          ) : null}

          <div className="mt-auto space-y-2 border-t border-[color:var(--hmr-border)]/60 pt-3">
            <label className="block text-xs">
              <span className="text-[color:var(--hmr-muted)]">Nome percorso</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Es. Giro del Monte"
                className="mt-1 w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-[color:var(--hmr-muted)]">
              <input
                type="checkbox"
                checked={visibility === "public"}
                onChange={(e) => setVisibility(e.target.checked ? "public" : "private")}
              />
              Percorso pubblico
            </label>
            <button
              type="button"
              disabled={saveBusy || !routeCoords || routeCoords.length < 2}
              onClick={() => void saveRoute()}
              className="w-full rounded-lg bg-[color:var(--hmr-accent)] px-4 py-2.5 text-sm font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
            >
              {saveBusy ? "Salvo…" : "Salva percorso"}
            </button>
            {routeId ? (
              <button
                type="button"
                disabled={outingBusy}
                onClick={() => void registerOuting()}
                className="w-full rounded-lg border border-[color:var(--hmr-border)] px-4 py-2.5 text-sm text-[color:var(--hmr-accent)] disabled:opacity-50"
              >
                {outingBusy ? "Registro…" : "Registra gita"}
              </button>
            ) : null}
            {err ? <p className="text-xs text-red-400">{err}</p> : null}
          </div>
        </aside>

        <div className="relative flex min-h-[50vh] min-w-0 flex-1 flex-col lg:min-h-0">
          <div className="relative min-h-0 flex-1">
            <V2PlanMap
              waypoints={waypoints}
              routeCoords={routeCoords}
              routeColoredSegments={routeTech?.colored_segments}
              pois={pois}
              poiSearchCenter={poiSearchCenter}
              poiSearchBbox={poiSearchBbox}
              pendingPoint={pendingPoint}
              onMapInteraction={onMapInteraction}
              onWaypointMove={moveWaypoint}
              onViewportChange={onViewportChange}
              initialCenter={mapCenter}
              flyTo={flyTo}
            />

            {mapAction && mapAction.kind !== "poi" ? (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-start sm:inset-x-auto sm:bottom-3 sm:left-3">
              <div className="pointer-events-auto max-w-[min(18rem,calc(100vw-5rem))] rounded-lg border border-[color:var(--hmr-border)]/90 bg-[color:var(--hmr-surface)]/94 px-2 py-1.5 shadow-lg backdrop-blur-sm">
                {mapAction.kind === "new_point" ? (
                  <>
                    <p className="truncate text-[10px] font-medium text-[color:var(--hmr-muted)]">
                      Punto selezionato
                      {insertPreview ? ` · tra ${insertPreview.after + 1}–${insertPreview.before + 1}` : null}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          insertInRoute(mapAction.lng, mapAction.lat, mapAction.label)
                        }
                        className="rounded-md bg-[color:var(--hmr-accent)] px-2 py-1 text-[10px] font-medium text-[color:var(--hmr-bg)]"
                      >
                        A metà
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNewDestination(mapAction.lng, mapAction.lat, mapAction.label)
                        }
                        className="rounded-md border border-[color:var(--hmr-border)] px-2 py-1 text-[10px]"
                      >
                        Arrivo
                      </button>
                      <button
                        type="button"
                        disabled={poiBusy}
                        onClick={() => void searchPoisNearby(mapAction.lng, mapAction.lat)}
                        className="rounded-md border border-orange-500/35 px-2 py-1 text-[10px] text-orange-300/90 disabled:opacity-50"
                      >
                        {poiBusy ? "…" : "POI"}
                      </button>
                      <button
                        type="button"
                        onClick={dismissAction}
                        className="rounded-md px-1.5 py-1 text-[10px] text-[color:var(--hmr-faint)]"
                        aria-label="Annulla"
                      >
                        ✕
                      </button>
                    </div>
                  </>
                ) : null}

                {mapAction.kind === "waypoint" ? (
                  <>
                    <p className="truncate text-[10px] font-medium">
                      Tappa {mapAction.index + 1}
                      {waypoints[mapAction.index]?.label ? ` · ${waypoints[mapAction.index].label}` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => removeWaypoint(mapAction.index)}
                        className="rounded-md border border-red-500/40 px-2 py-1 text-[10px] text-red-400"
                      >
                        Elimina
                      </button>
                      <button
                        type="button"
                        disabled={poiBusy}
                        onClick={() => void searchPoisNearby(mapAction.lng, mapAction.lat)}
                        className="rounded-md border border-orange-500/35 px-2 py-1 text-[10px] text-orange-300/90 disabled:opacity-50"
                      >
                        {poiBusy ? "…" : "POI"}
                      </button>
                      <button
                        type="button"
                        onClick={dismissAction}
                        className="rounded-md px-1.5 py-1 text-[10px] text-[color:var(--hmr-faint)]"
                        aria-label="Annulla"
                      >
                        ✕
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

            {mapAction?.kind === "poi" ? (
              <V2PoiBanner
                poi={mapAction.poi}
                onClose={dismissAction}
                onInsertInRoute={() =>
                  insertInRoute(
                    mapAction.poi.lng,
                    mapAction.poi.lat,
                    mapAction.poi.name ?? mapAction.poi.sub_kind
                  )
                }
                onSetDestination={() =>
                  setNewDestination(
                    mapAction.poi.lng,
                    mapAction.poi.lat,
                    mapAction.poi.name ?? mapAction.poi.sub_kind
                  )
                }
              />
            ) : null}
          </div>

          <div
            className="shrink-0 border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)]/97"
            style={{ height: "var(--hmr-profile-strip)" }}
          >
            {profileCoords.length >= 2 ? (
              <ElevationChart
                coords={profileCoords}
                sections={[]}
                checkpoints={[]}
                atKm={null}
                hoverKm={hoverKm}
                onHoverKm={setHoverKm}
                surfaceBands={routeTech?.surface_bands}
                wrapperClassName="!rounded-none !border-0 !bg-transparent !shadow-none h-full min-h-0 w-full min-w-0"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-3 text-[11px] text-[color:var(--hmr-muted)]">
                Profilo altimetrico disponibile con almeno 2 tappe e percorso calcolato
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
