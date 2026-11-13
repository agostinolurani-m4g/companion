"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { V2MapClickTarget } from "@/components/v2/V2PlanMap";
import type { UserRouteActivity } from "@/lib/db";
import {
  applyExploreSelection,
  exploreRouteView,
  type ExploreScope,
} from "@/lib/explore";
import { fetchJson } from "@/lib/fetch-json";
import { buildRouteMarkersGeoJsonFromTracks, SKI_AVALANCHE_DEFAULT_OPACITY, SKI_SLOPE_DEFAULT_OPACITY } from "@/lib/ski-overlays";
import type { FieldReportKind } from "@/lib/field-reports";
import { routeEditorHref } from "@/lib/sports";
import type { RouteFacts } from "@/lib/route-facts";
import { routeAvalancheCheckUrl, type RouteAvalancheNote } from "@/lib/route-avalanche-query";

export type ExploreRouteSummary = {
  id: string;
  name: string;
  owner: string;
  activity: UserRouteActivity;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  source: string | null;
  source_url: string | null;
  license: string | null;
  start: [number, number] | null;
  end: [number, number] | null;
  outing_count?: number;
  /** Grado principale (es. «T3», «2.3») e tempo stimato in minuti, da route-facts. */
  difficulty_label?: string | null;
  duration_min?: number | null;
  /** Mostrato per affinità con lo sport scelto (es. escursionismo per la corsa). */
  affinity?: boolean;
};

type GroupItem = { id: string; name: string };

export function useV2ExploreState(enabled: boolean, username?: string) {
  const router = useRouter();
  const [scope, setScope] = useState<ExploreScope>("public");
  const [activity, setActivity] = useState<UserRouteActivity | "all">("all");
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [exploreGeoJson, setExploreGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [routes, setRoutes] = useState<ExploreRouteSummary[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; key?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [slopeVisible, setSlopeVisible] = useState(false);
  const [avalancheVisible, setAvalancheVisible] = useState(false);
  const [reportsVisible, setReportsVisible] = useState(true);
  const [photosVisible, setPhotosVisible] = useState(true);
  const [avalancheGeoJson, setAvalancheGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [reportsGeoJson, setReportsGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [photosGeoJson, setPhotosGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);

  const [reportMode, setReportMode] = useState(false);
  const [createReportAt, setCreateReportAt] = useState<{ lng: number; lat: number } | null>(null);
  const [selectedReport, setSelectedReport] = useState<{
    id: string;
    author: string;
    kind: FieldReportKind;
    kind_label: string;
    description: string;
    confirmation_count: number;
    verified: boolean;
    status: string;
    photo_url?: string | null;
  } | null>(null);
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [mapBbox, setMapBbox] = useState<{ south: number; west: number; north: number; east: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      try {
        const res = await fetch("/api/v2/groups");
        const data = (await res.json()) as { groups?: GroupItem[] };
        if (data.groups) setGroups(data.groups.map((g) => ({ id: g.id, name: g.name })));
      } catch {
        /* optional */
      }
    })();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || activity !== "ski") return;
    void (async () => {
      try {
        const data = await fetchJson<{ features?: GeoJSON.Feature[] }>("/api/v2/ski/avalanche");
        if (data.features) {
          setAvalancheGeoJson({ type: "FeatureCollection", features: data.features });
        }
      } catch {
        /* optional */
      }
    })();
  }, [enabled, activity]);

  const loadOverlays = useCallback(async (bbox: typeof mapBbox) => {
    if (!bbox) return;
    const q = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
    try {
      const [rep, pho] = await Promise.all([
        fetchJson<{ geojson?: GeoJSON.FeatureCollection }>(`/api/v2/reports?bbox=${q}`),
        fetchJson<{ photos?: Array<{ id: string; lng: number; lat: number; owner: string }> }>(
          `/api/v2/photos?bbox=${q}`,
        ),
      ]);
      setReportsGeoJson(rep.geojson ?? { type: "FeatureCollection", features: [] });
      setPhotosGeoJson({
        type: "FeatureCollection",
        features: (pho.photos ?? []).map((p) => ({
          type: "Feature",
          properties: { photoId: p.id, owner: p.owner },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        })),
      });
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    if (enabled && mapBbox) void loadOverlays(mapBbox);
  }, [enabled, mapBbox, loadOverlays]);

  const [totalInArea, setTotalInArea] = useState(0);
  const reqSeq = useRef(0);

  /**
   * Carica i percorsi dell'area visibile (solo "Pubblici"; gite e gruppi sono liste piccole).
   * Le richieste superate da una più recente vengono scartate.
   */
  const loadExplore = useCallback(
    async (s: ExploreScope, act: UserRouteActivity | "all", bbox: typeof mapBbox, zoom: number) => {
      const seq = ++reqSeq.current;
      setBusy(true);
      setErr(null);
      try {
        const actQ = act === "all" ? "" : `&activity=${encodeURIComponent(act)}`;
        const bboxQ =
          s === "public" && bbox
            ? `&bbox=${[bbox.south, bbox.west, bbox.north, bbox.east].map((v) => v.toFixed(4)).join(",")}&zoom=${Math.round(zoom)}`
            : "";
        const data = await fetchJson<{
          geojson?: GeoJSON.FeatureCollection;
          routes?: ExploreRouteSummary[];
          total?: number;
        }>(`/api/v2/explore?scope=${encodeURIComponent(s)}${actQ}${bboxQ}`);
        if (seq !== reqSeq.current) return;
        setExploreGeoJson(data.geojson ?? { type: "FeatureCollection", features: [] });
        setRoutes(data.routes ?? []);
        setTotalInArea(data.total ?? data.routes?.length ?? 0);
      } catch (e) {
        if (seq !== reqSeq.current) return;
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === reqSeq.current) setBusy(false);
      }
    },
    [],
  );

  // Cambio filtro: azzera selezione.
  useEffect(() => {
    setSelectedRouteId(null);
    setFlyTo(null);
  }, [scope, activity]);

  // Ricarica (con debounce) quando cambiano filtri o area visibile.
  const [mapZoom, setMapZoom] = useState(12);
  useEffect(() => {
    if (!enabled) return;
    if (scope === "public" && !mapBbox) return;
    const t = setTimeout(() => void loadExplore(scope, activity, mapBbox, mapZoom), 350);
    return () => clearTimeout(t);
  }, [enabled, scope, activity, mapBbox, mapZoom, loadExplore]);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  );

  // Fatti completi (difficoltà, testo, segnavia…) del percorso selezionato, senza geometria.
  const [selectedFacts, setSelectedFacts] = useState<{ id: string; facts: RouteFacts } | null>(null);
  useEffect(() => {
    if (!enabled || !selectedRouteId) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchJson<{ id: string; facts?: RouteFacts }>(
          `/api/v2/routes/${encodeURIComponent(selectedRouteId)}?only=facts`,
        );
        if (!cancelled && data.facts) setSelectedFacts({ id: selectedRouteId, facts: data.facts });
      } catch {
        /* opzionale: la scheda resta con km/D+ */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, selectedRouteId]);

  // Sci: esposizioni del percorso confrontate con il bollettino valanghe nel punto di partenza.
  const [avalancheNote, setAvalancheNote] = useState<{ id: string; note: RouteAvalancheNote } | null>(null);
  const factsForSelected = selectedFacts && selectedFacts.id === selectedRouteId ? selectedFacts.facts : null;
  const avalancheUrl =
    selectedRoute?.activity === "ski" ? routeAvalancheCheckUrl(selectedRoute.start, factsForSelected) : null;
  useEffect(() => {
    if (!enabled || !avalancheUrl || !selectedRouteId) return;
    let cancelled = false;
    const id = selectedRouteId;
    void (async () => {
      try {
        const data = await fetchJson<{ point?: { aspectCheck?: RouteAvalancheNote } }>(avalancheUrl);
        const check = data.point?.aspectCheck;
        if (!cancelled && check?.text) setAvalancheNote({ id, note: { status: check.status, text: check.text } });
      } catch {
        /* opzionale */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, avalancheUrl, selectedRouteId]);

  const displayGeoJson = useMemo(() => {
    if (!exploreGeoJson) return null;
    return applyExploreSelection(exploreGeoJson, selectedRouteId);
  }, [exploreGeoJson, selectedRouteId]);

  const routeMarkersGeoJson = useMemo(() => {
    if (!selectedRouteId || !exploreGeoJson) return null;
    let ac: [number, number][] | null = null;
    let dc: [number, number][] | null = null;
    for (const f of exploreGeoJson.features) {
      const p = f.properties as { routeId?: string; mode?: string };
      if (p.routeId !== selectedRouteId || f.geometry?.type !== "LineString") continue;
      const coords = f.geometry.coordinates as [number, number][];
      if (p.mode === "descent") dc = coords;
      else ac = coords;
    }
    return buildRouteMarkersGeoJsonFromTracks(ac, dc, {
      elevGainM: selectedRoute?.elev_gain_m ?? 0,
      elevLossM: selectedRoute?.elev_loss_m ?? 0,
    });
  }, [selectedRouteId, exploreGeoJson, selectedRoute]);

  // Vola sul percorso solo quando cambia la selezione (non a ogni ricarica per area).
  const flownForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !selectedRouteId || !exploreGeoJson) {
      if (!selectedRouteId) flownForRef.current = null;
      return;
    }
    if (flownForRef.current === selectedRouteId) return;
    const view = exploreRouteView(exploreGeoJson, selectedRouteId);
    if (view) {
      flownForRef.current = selectedRouteId;
      setFlyTo({ ...view, key: Date.now() });
    }
  }, [enabled, selectedRouteId, exploreGeoJson]);

  const onMapInteraction = useCallback(
    (target: V2MapClickTarget) => {
      if (target.kind === "map" && reportMode) {
        setCreateReportAt({ lng: target.lng, lat: target.lat });
        setReportMode(false);
      }
    },
    [reportMode],
  );

  const scopeLabel = useMemo(() => {
    if (scope === "public") return "Pubblici";
    if (scope === "mine") return "Mie gite";
    const gid = scope.slice("group:".length);
    return groups.find((g) => g.id === gid)?.name ?? "Gruppo";
  }, [scope, groups]);

  return {
    router,
    scope,
    setScope,
    activity,
    setActivity,
    groups,
    routes,
    busy,
    err,
    scopeLabel,
    selectedRouteId,
    setSelectedRouteId,
    selectedRoute,
    selectedFacts: factsForSelected,
    selectedAvalancheNote: avalancheNote && avalancheNote.id === selectedRouteId ? avalancheNote.note : null,
    flyTo,
    displayGeoJson,
    routeMarkersGeoJson,
    onMapInteraction,
    mapBbox,
    setMapBbox,
    setMapZoom,
    totalInArea,
    slopeVisible,
    setSlopeVisible,
    avalancheVisible,
    setAvalancheVisible,
    reportsVisible,
    setReportsVisible,
    photosVisible,
    setPhotosVisible,
    avalancheGeoJson,
    reportsGeoJson,
    photosGeoJson,
    reportMode,
    setReportMode,
    createReportAt,
    setCreateReportAt,
    selectedReport,
    setSelectedReport,
    showPhotoCapture,
    setShowPhotoCapture,
    loadOverlays,
    routeEditorHref,
    username,
    slopeOpacity: SKI_SLOPE_DEFAULT_OPACITY,
    avalancheOpacity: SKI_AVALANCHE_DEFAULT_OPACITY,
  };
}
