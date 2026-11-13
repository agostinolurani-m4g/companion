"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import V2OutingList, { outingHref } from "@/components/v2/V2OutingList";
import V2OutingPlanPanel from "@/components/v2/V2OutingPlanPanel";
import V2PrecisionForecast from "@/components/v2/V2PrecisionForecast";
import { stopKindFromOutdoorKind, stopKindFromPoiCategory } from "@/lib/outings-types";
import { useOutingDraft } from "@/lib/use-outing-draft";
import V2ExploreAside from "@/components/v2/V2ExploreAside";
import V2PhotoCapture from "@/components/v2/V2PhotoCapture";
import V2RoutePopularity, {
  untroddenFeatureCollection,
  type RouteAlternativeDto,
  type RoutePopularityDto,
} from "@/components/v2/V2RoutePopularity";
import V2ReportSheet, { V2ReportCreateSheet } from "@/components/v2/V2ReportSheet";
import V2SkiRouteBanner from "@/components/v2/V2SkiRouteBanner";
import V2PlanMap, { type V2MapClickTarget, type V2Waypoint } from "@/components/v2/V2PlanMap";
import V2PoiBanner, { targetFromMapPlace, targetFromSearchPoi } from "@/components/v2/V2PoiBanner";
import V2FeatureSheet from "@/components/v2/V2FeatureSheet";
import V2AreaDataPanel from "@/components/v2/V2AreaDataPanel";
import V2AlongRoutePanel from "@/components/v2/V2AlongRoutePanel";
import V2WaypointList from "@/components/v2/V2WaypointList";
import V2PlaceSearch, { type PlaceSearchResult } from "@/components/v2/V2PlaceSearch";
import ElevationProfile from "@/components/v2/ui/ElevationProfile";
import MapPanel, { DESKTOP_PANEL_W, type PanelSnap } from "@/components/v2/ui/MapPanel";
import Icon from "@/components/v2/ui/Icon";
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
import { coordAtKm } from "@/lib/track-measure";
import type { RouteTech } from "@/lib/ors-route-tech";
import {
  formatTerrainIt,
  SURFACE_COLORS,
  WAY_CATEGORY_COLORS,
  WAY_CATEGORY_LABELS,
  WAY_CATEGORY_ORDER,
} from "@/lib/ors-route-tech";
import type { RoutePreference } from "@/lib/openrouteservice-route";
import type { TrackSurfaceKind } from "@/lib/surface-osm";
import { isUserRouteActivity, outingNewHref, outingPlanHref, routeEditorHref, SPORTS } from "@/lib/sports";
import V2ConditionsPanel from "@/components/v2/V2ConditionsPanel";
import V2SportChips from "@/components/v2/V2SportChips";
import { useFieldReportsOnMap } from "@/lib/use-field-reports-map";
import { useOutdoorFeaturesOnMap } from "@/lib/use-outdoor-features-map";
import type { OutdoorGroup } from "@/lib/outdoor/groups";
import type { V2MapPlacePick, V2OutdoorFeaturePick } from "@/components/v2/map/types";
import { featuresAlongRoute } from "@/lib/outdoor/along";
import { planFeatureCollection } from "@/lib/outdoor/plan-relevance";
import { useV2ExploreState } from "@/lib/use-v2-explore-state";
import { SKI_AVALANCHE_DEFAULT_OPACITY, SKI_SLOPE_DEFAULT_OPACITY } from "@/lib/ski-overlays";
import { estimateDurationMin, formatDuration } from "@/lib/route-time";
import { geojsonLineToGpx } from "@/lib/gpx";
import { insertIndexForPoint } from "@/lib/route-insert";

type Props = {
  isAdmin?: boolean;
  username?: string;
};

type MapAction =
  | { kind: "new_point"; lng: number; lat: number; label?: string }
  | { kind: "waypoint"; index: number; lng: number; lat: number }
  | { kind: "poi"; poi: V2SearchPoi };

type PlanTab = "route" | "outing" | "nearby" | "conditions";

const POI_RADIUS_PRESETS: PoiKindMeta[] = SEARCH_KINDS;
const POI_SEARCH_RADIUS_M = 3000;
/** Larghezza card desktop + margini (allineare con MapPanel). */
const DESKTOP_PANEL_SPACE = DESKTOP_PANEL_W;
const DESKTOP_PROFILE_H = 150;

const PREFERENCE_LABELS: Record<RoutePreference, { foot: string; bike: string; hint: string }> = {
  recommended: { foot: "Consigliato", bike: "Consigliato", hint: "Bilancia distanza, tipo di via e sicurezza" },
  shortest: { foot: "Più breve", bike: "Più breve", hint: "Distanza minima" },
  quiet: { foot: "Nel verde", bike: "Meno salite", hint: "A piedi: vie tranquille e nel verde · In bici: pendenze più dolci" },
};

/** Distanza massima (m) entro cui una tappa viene spostata sulla via più vicina. */
const PIN_SNAP_LIMIT_M = 40;

function metersBetween(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const kx = 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((b.lng - a.lng) * kx, (b.lat - a.lat) * 110_540);
}

function routeKey(wps: V2Waypoint[], act: string, pref: string, cw = false): string {
  return `${act}|${pref}${cw ? "+cw" : ""}|${wps.map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(";")}`;
}

/** Aggiunge un nuovo punto di arrivo; il precedente resta come tappa intermedia. */
function applyArrivalPoint(wps: V2Waypoint[], lng: number, lat: number, label?: string): V2Waypoint[] {
  return [...wps, { lng, lat, label }];
}

/** Inserisce il punto nel tratto giusto del tracciato calcolato (vedi route-insert). */
function applyInsertInRoute(
  wps: V2Waypoint[],
  lng: number,
  lat: number,
  label: string | undefined,
  route: [number, number][] | null,
): V2Waypoint[] {
  const p: V2Waypoint = { lng, lat, label };
  if (wps.length === 0) return [p];
  if (wps.length === 1) return [...wps, p];
  const { index } = insertIndexForPoint(wps, p, route);
  return [...wps.slice(0, index), p, ...wps.slice(index)];
}

function bboxOfCoords(coords: [number, number][]): [number, number, number, number] | null {
  if (coords.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "percorso"
  );
}

function StatCell({ label, value, unit, icon }: { label: string; value: string; unit?: string; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--hmr-faint)]">
        {icon}
        {label}
      </div>
      <div className="truncate">
        <span className="ui-stat-value">{value}</span>
        {unit ? <span className="ui-stat-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between gap-2 first:mt-1">
      <h3 className="ui-eyebrow">{children}</h3>
      {right}
    </div>
  );
}

export default function V2RouteBuilder({ username }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeId = searchParams.get("route");
  const activityParam = searchParams.get("activity");
  const isExplore = searchParams.get("mode") === "explore";
  const outingId = searchParams.get("outing");
  const wantsOutingTab = searchParams.get("tab") === "outing" || !!outingId;
  const explore = useV2ExploreState(isExplore, username);

  const [activity, setActivity] = useState<UserRouteActivity>(() =>
    activityParam && isUserRouteActivity(activityParam) ? activityParam : "hike",
  );
  const [waypoints, setWaypoints] = useState<V2Waypoint[]>([]);
  const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
  const [routeTech, setRouteTech] = useState<RouteTech | null>(null);
  const [popularity, setPopularity] = useState<RoutePopularityDto | null>(null);
  const [alternatives, setAlternatives] = useState<RouteAlternativeDto[]>([]);
  const [lengthKm, setLengthKm] = useState(0);
  const [elevGainM, setElevGainM] = useState(0);
  const [elevLossM, setElevLossM] = useState(0);
  const [elevAvailable, setElevAvailable] = useState(true);
  const [pois, setPois] = useState<V2SearchPoi[]>([]);
  const [poiSearchCenter, setPoiSearchCenter] = useState<{ lng: number; lat: number } | null>(null);
  const [poiSearchBbox, setPoiSearchBbox] = useState<ViewBbox | null>(null);
  const [mapViewport, setMapViewport] = useState<ViewBbox | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(DEFAULT_MAP_VIEW_CENTER.zoom ?? 12);
  const [mapCenter] = useState<{ lng: number; lat: number; zoom?: number } | undefined>(
    DEFAULT_MAP_VIEW_CENTER,
  );
  const { reports, reportsGeoJson } = useFieldReportsOnMap(mapViewport);
  const [outdoorGroupFilter, setOutdoorGroupFilter] = useState<OutdoorGroup[] | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<V2OutdoorFeaturePick | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<V2MapPlacePick | null>(null);
  const placeTarget = useMemo(() => (selectedPlace ? targetFromMapPlace(selectedPlace) : null), [selectedPlace]);
  // I gruppi selezionati non filtrano più i dati: evidenziano i loro pallini sulla mappa.
  const { featuresGeoJson: outdoorRawGeoJson, busy: outdoorBusy } = useOutdoorFeaturesOnMap(
    mapViewport,
    mapZoom,
    activity,
    null,
    !isExplore,
  );
  const [routing, setRouting] = useState(false);
  const [poiBusy, setPoiBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<UserRouteVisibility>("private");
  const [mapAction, setMapAction] = useState<MapAction | null>(null);
  const poiTarget = useMemo(
    () => (mapAction?.kind === "poi" ? targetFromSearchPoi(mapAction.poi) : null),
    [mapAction],
  );
  const [profileCoords, setProfileCoords] = useState<StoredCoord[]>([]);
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(null);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; key: number } | null>(null);
  const [fitTo, setFitTo] = useState<{ bbox: [number, number, number, number]; key: number } | null>(null);
  const flyKeyRef = useRef(0);
  const [selectedViewportKinds, setSelectedViewportKinds] = useState<Set<PoiKind>>(
    () => new Set(VIEWPORT_SEARCH_KINDS.map((k) => k.id)),
  );
  const [tab, setTab] = useState<PlanTab>(wantsOutingTab ? "outing" : "route");
  /** Traccia caricata senza tappe (GPX importato): non va ricalcolata né cancellata. */
  const importedTrackRef = useRef(false);
  const [importedTrack, setImportedTrack] = useState(false);
  const [preference, setPreference] = useState<RoutePreference>("recommended");
  /** Solo bici da strada: prende le ciclabili asfaltate quando non allungano troppo. */
  const [preferCycleways, setPreferCycleways] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("v2.preferCycleways") === "1") setPreferCycleways(true);
    } catch {}
  }, []);
  const togglePreferCycleways = useCallback(() => {
    setPreferCycleways((v) => {
      try {
        localStorage.setItem("v2.preferCycleways", v ? "0" : "1");
      } catch {}
      return !v;
    });
  }, []);
  const cyclewaysOn = preferCycleways && activity === "road";
  const [colorBy, setColorBy] = useState<"surface" | "category">("category");
  const [snap, setSnap] = useState<PanelSnap>("peek");
  // Link "pianifica gita" (?tab=outing): apre la scheda Gita.
  useEffect(() => {
    if (wantsOutingTab) {
      setTab("outing");
      setSnap((v) => (v === "peek" ? "half" : v));
    }
  }, [wantsOutingTab]);
  const [sheetH, setSheetH] = useState(0);

  const routeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ─────────────── Cronologia tappe (annulla / ripeti) ─────────────── */
  const waypointsRef = useRef<V2Waypoint[]>([]);
  useEffect(() => {
    waypointsRef.current = waypoints;
  }, [waypoints]);
  const historyRef = useRef<{ past: V2Waypoint[][]; future: V2Waypoint[][]; lastMoveAt: number }>({
    past: [],
    future: [],
    lastMoveAt: 0,
  });
  const [historyLen, setHistoryLen] = useState({ past: 0, future: 0 });
  const syncHistory = useCallback(() => {
    const h = historyRef.current;
    setHistoryLen({ past: h.past.length, future: h.future.length });
  }, []);

  const commitWaypoints = useCallback((updater: (wps: V2Waypoint[]) => V2Waypoint[]) => {
    const cur = waypointsRef.current;
    const next = updater(cur);
    if (next === cur) return;
    const h = historyRef.current;
    h.past.push(cur);
    if (h.past.length > 100) h.past.shift();
    h.future = [];
    waypointsRef.current = next;
    setWaypoints(next);
    syncHistory();
  }, [syncHistory]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(waypointsRef.current);
    waypointsRef.current = prev;
    setWaypoints(prev);
    setSelectedWaypointIndex(null);
    setMapAction(null);
    syncHistory();
  }, [syncHistory]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(waypointsRef.current);
    waypointsRef.current = next;
    setWaypoints(next);
    syncHistory();
  }, [syncHistory]);

  const canUndo = historyLen.past > 0;
  const canRedo = historyLen.future > 0;

  /* ─────────────── Routing ─────────────── */
  const routeAbortRef = useRef<AbortController | null>(null);
  /** Tappe appena agganciate al sentiero: il percorso è già quello giusto, niente nuovo calcolo. */
  const skipRouteKeyRef = useRef<string | null>(null);

  const fetchRoute = useCallback(async (wps: V2Waypoint[], act: UserRouteActivity, pref: RoutePreference, cw: boolean) => {
    routeAbortRef.current?.abort();
    if (wps.length < 2 && importedTrackRef.current) {
      // Traccia importata: resta com'è finché non si disegnano almeno due tappe.
      setRouting(false);
      return;
    }
    if (wps.length >= 2) {
      importedTrackRef.current = false;
      setImportedTrack(false);
    }
    if (wps.length < 2) {
      setRouting(false);
      setRouteCoords(null);
      setRouteTech(null);
      setPopularity(null);
      setAlternatives([]);
      setLengthKm(0);
      setElevGainM(0);
      setElevLossM(0);
      return;
    }
    // Una richiesta superata (tappa spostata di nuovo) viene annullata: niente risposte vecchie
    // che arrivano dopo e sovrascrivono il percorso nuovo.
    const ctrl = new AbortController();
    routeAbortRef.current = ctrl;
    setRouting(true);
    setErr(null);
    try {
      const coordinates = wps.map((w) => [w.lng, w.lat] as [number, number]);
      const res = await fetch("/api/v2/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinates,
          activity: act,
          preference: pref,
          preferCycleways: cw,
          alternatives: coordinates.length === 2,
        }),
        signal: ctrl.signal,
      });
      const data = (await res.json()) as {
        error?: string;
        feature?: GeoJSON.Feature<GeoJSON.LineString>;
        length_km?: number;
        tech?: RouteTech | null;
        snapped?: [number, number][] | null;
        popularity?: RoutePopularityDto | null;
        alternatives?: RouteAlternativeDto[];
      };
      if (ctrl.signal.aborted) return;
      if (!res.ok || !data.feature) throw new Error(data.error ?? "Routing fallito");
      setRouteCoords(data.feature.geometry.coordinates as [number, number][]);
      setRouteTech(data.tech ?? null);
      setLengthKm(data.length_km ?? 0);
      setPopularity(data.popularity ?? null);
      setAlternatives(data.alternatives ?? []);

      // Pallini sul sentiero: le tappe prendono la posizione dove ORS le ha agganciate.
      const snapped = data.snapped;
      const cur = waypointsRef.current;
      if (snapped && snapped.length === cur.length && cur === wps) {
        // L'aggancio ha un limite: oltre, il pallino resta dove l'hai messo (non salta su una
        // via lontana) e il percorso parte dalla via più vicina.
        const dist = snapped.map(([lng, lat], i) => metersBetween(cur[i]!, { lng, lat }));
        const far = dist.findIndex((d) => d > PIN_SNAP_LIMIT_M);
        if (far >= 0) {
          setNotice(`Tappa ${far + 1} a ${Math.round(dist[far]!)} m dalla via più vicina: il percorso passa da lì, il pallino resta dov'è.`);
          setTimeout(() => setNotice(null), 5000);
        }
        const moved = dist.some((d) => d > 3 && d <= PIN_SNAP_LIMIT_M);
        if (moved) {
          const next = cur.map((w, i) =>
            dist[i]! <= PIN_SNAP_LIMIT_M ? { ...w, lng: snapped[i]![0], lat: snapped[i]![1] } : w,
          );
          skipRouteKeyRef.current = routeKey(next, act, pref, cw);
          waypointsRef.current = next;
          setWaypoints(next);
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setErr(e instanceof Error ? e.message : String(e));
      setRouteCoords(null);
      setRouteTech(null);
      setPopularity(null);
      setAlternatives([]);
      setLengthKm(0);
      setElevGainM(0);
      setElevLossM(0);
    } finally {
      if (routeAbortRef.current === ctrl) setRouting(false);
    }
  }, []);

  useEffect(() => {
    if (routeTimer.current) clearTimeout(routeTimer.current);
    if (skipRouteKeyRef.current && skipRouteKeyRef.current === routeKey(waypoints, activity, preference, cyclewaysOn)) {
      skipRouteKeyRef.current = null;
      return;
    }
    skipRouteKeyRef.current = null;
    routeTimer.current = setTimeout(() => {
      void fetchRoute(waypoints, activity, preference, cyclewaysOn);
    }, 200);
    return () => {
      if (routeTimer.current) clearTimeout(routeTimer.current);
    };
  }, [waypoints, activity, preference, cyclewaysOn, fetchRoute]);

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
      const { distanceKm, elevationM, sampled, available } = await sampleElevationsForLine(positions);
      if (cancelled) return;
      setElevAvailable(available);
      if (!available) {
        // Niente profilo inventato: meglio "—" che un dislivello falso.
        setElevGainM(0);
        setElevLossM(0);
        setProfileCoords([]);
        return;
      }
      const { gain, loss } = elevationGainLossSmoothed(elevationM);
      setElevGainM(gain);
      setElevLossM(loss);
      const displayWindow = Math.max(3, Math.min(7, Math.round(elevationM.length / 20)));
      const smoothed = smoothElevationProfile(elevationM, displayWindow);
      setProfileCoords(sampled.map((p, i) => [p[0], p[1], smoothed[i] ?? null, distanceKm[i] ?? 0] as StoredCoord));
    })();
    return () => {
      cancelled = true;
    };
  }, [routeCoords]);

  /* ─────────────── Caricamento percorso salvato ─────────────── */
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
        const wps = (Array.isArray(r.waypoints) ? r.waypoints : []).map(([lng, lat]) => ({ lng, lat }));
        importedTrackRef.current = wps.length < 2;
        setImportedTrack(wps.length < 2);
        waypointsRef.current = wps;
        historyRef.current = { past: [], future: [], lastMoveAt: 0 };
        syncHistory();
        setWaypoints(wps);
        const coords = r.geojson.geometry.coordinates as [number, number][];
        setRouteCoords(coords);
        setLengthKm(r.length_km);
        const bb = bboxOfCoords(coords);
        if (bb) setFitTo({ bbox: bb, key: Date.now() });
        setSnap("half");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [routeId, syncHistory]);

  /* ─────────────── Interazione mappa ─────────────── */
  const onMapInteraction = useCallback((target: V2MapClickTarget) => {
    if (target.kind === "map") {
      // Primo punto: diventa subito la partenza (niente popup inutile).
      if (waypointsRef.current.length === 0) {
        commitWaypoints((wps) => [...wps, { lng: target.lng, lat: target.lat }]);
        setMapAction(null);
        return;
      }
      setMapAction({ kind: "new_point", lng: target.lng, lat: target.lat });
      return;
    }
    if (target.kind === "waypoint") {
      setSelectedWaypointIndex(target.index);
      setMapAction({ kind: "waypoint", index: target.index, lng: target.lng, lat: target.lat });
      return;
    }
    if (target.kind === "feature") {
      setMapAction(null);
      setSelectedPlace(null);
      setSelectedFeature(target.feature);
      return;
    }
    if (target.kind === "place") {
      setMapAction(null);
      setSelectedFeature(null);
      setSelectedPlace(target.place);
      return;
    }
    setSelectedPlace(null);
    setMapAction({ kind: "poi", poi: target.poi });
  }, [commitWaypoints]);

  const exploreOnMap = explore.onMapInteraction;
  const onExploreMapInteraction = useCallback(
    (target: V2MapClickTarget) => {
      if (target.kind === "place") {
        setSelectedPlace(target.place);
        return;
      }
      setSelectedPlace(null);
      exploreOnMap(target);
    },
    [exploreOnMap],
  );

  const toggleOutdoorGroup = useCallback((grp: OutdoorGroup) => {
    setOutdoorGroupFilter((prev) => {
      const cur = prev ?? [];
      const next = cur.includes(grp) ? cur.filter((g) => g !== grp) : [...cur, grp];
      return next.length === 0 ? null : next;
    });
  }, []);

  // Cancelli solo sul tracciato, parcheggi/stazioni solo vicino alla partenza.
  const featuresGeoJson = useMemo(
    () =>
      planFeatureCollection(
        outdoorRawGeoJson,
        { route: routeCoords, start: waypoints[0] ? { lng: waypoints[0].lng, lat: waypoints[0].lat } : null },
        outdoorGroupFilter,
      ),
    [outdoorRawGeoJson, routeCoords, waypoints, outdoorGroupFilter],
  );
  // Conteggi dei chip sui punti davvero mostrati (senza i cancelli fuori percorso & co.).
  const groupCounts = useMemo(() => {
    const n = new Map<string, number>();
    for (const f of featuresGeoJson?.features ?? []) {
      const grp = (f.properties as { grp?: string } | null)?.grp;
      if (grp) n.set(grp, (n.get(grp) ?? 0) + 1);
    }
    return [...n].map(([grp, count]) => ({ grp, n: count }));
  }, [featuresGeoJson]);

  const routeReportWarning = useMemo(() => {
    if (!routeCoords || routeCoords.length < 2 || reports.length === 0) return null;
    const pseudoFeatures = reports.map((r) => ({
      id: r.id,
      osm_type: "node",
      osm_id: 0,
      grp: "hazard",
      kind: "access_no",
      name: r.kind,
      lat: r.lat,
      lng: r.lng,
      ele: null,
      tags_json: "{}",
      geom_json: null,
      source: "report",
      updated_at: 0,
    }));
    const hits = featuresAlongRoute(routeCoords, pseudoFeatures, 300);
    return hits.length > 0 ? hits.length : null;
  }, [routeCoords, reports]);

  const dismissAction = useCallback(() => {
    setMapAction(null);
    setSelectedWaypointIndex(null);
  }, []);

  const routeCoordsRef = useRef<[number, number][] | null>(null);
  useEffect(() => {
    routeCoordsRef.current = routeCoords;
  }, [routeCoords]);

  const insertInRoute = (lng: number, lat: number, label?: string) => {
    commitWaypoints((wps) => applyInsertInRoute(wps, lng, lat, label, routeCoordsRef.current));
    dismissAction();
  };

  /**
   * Inizio trascinamento della linea del percorso: crea una tappa nel tratto afferrato e
   * ne restituisce l'indice; i movimenti successivi passano da moveWaypoint (stesso gesto
   * = un solo passo di annulla).
   */
  const startRouteDrag = useCallback(
    (lng: number, lat: number): number | null => {
      const wps = waypointsRef.current;
      if (wps.length < 2) return null;
      const { index } = insertIndexForPoint(wps, { lng, lat }, routeCoordsRef.current);
      const next = [...wps.slice(0, index), { lng, lat }, ...wps.slice(index)];
      const h = historyRef.current;
      h.past.push(wps);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      h.lastMoveAt = Date.now();
      waypointsRef.current = next;
      setWaypoints(next);
      syncHistory();
      setMapAction(null);
      setSelectedWaypointIndex(null);
      return index;
    },
    [syncHistory],
  );

  const setNewDestination = (lng: number, lat: number, label?: string) => {
    commitWaypoints((wps) => applyArrivalPoint(wps, lng, lat, label));
    dismissAction();
  };

  const setAsStart = (lng: number, lat: number, label?: string) => {
    commitWaypoints((wps) => [{ lng, lat, label }, ...wps]);
    dismissAction();
  };

  const removeWaypoint = (index: number) => {
    commitWaypoints((wps) => wps.filter((_, i) => i !== index));
    dismissAction();
  };

  /** Drag sulla mappa: un solo passo di cronologia per gesto. */
  const moveWaypoint = useCallback((index: number, lng: number, lat: number) => {
    const h = historyRef.current;
    const now = Date.now();
    if (now - h.lastMoveAt > 900) {
      h.past.push(waypointsRef.current);
      h.future = [];
      syncHistory();
    }
    h.lastMoveAt = now;
    const next = waypointsRef.current.map((w, i) => (i === index ? { ...w, lng, lat } : w));
    waypointsRef.current = next;
    setWaypoints(next);
  }, [syncHistory]);

  const reorderWaypoints = (next: V2Waypoint[]) => {
    commitWaypoints(() => next);
    setSelectedWaypointIndex(null);
  };

  const reverseRoute = () => commitWaypoints((wps) => (wps.length < 2 ? wps : [...wps].reverse()));
  const closeLoop = () =>
    commitWaypoints((wps) => {
      if (wps.length < 2) return wps;
      const first = wps[0];
      const last = wps[wps.length - 1];
      if (Math.abs(first.lng - last.lng) < 1e-6 && Math.abs(first.lat - last.lat) < 1e-6) return wps;
      return [...wps, { lng: first.lng, lat: first.lat, label: first.label ? `${first.label} (ritorno)` : "Ritorno al via" }];
    });

  const clearAll = () => {
    commitWaypoints(() => []);
    setRouteCoords(null);
    setRouteTech(null);
    setLengthKm(0);
    setElevGainM(0);
    setElevLossM(0);
    setPois([]);
    setPoiSearchCenter(null);
    setPoiSearchBbox(null);
    setMapAction(null);
  };

  /* Scorciatoie tastiera: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Esc */
  useEffect(() => {
    if (isExplore) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Escape") {
        dismissAction();
        setSelectedFeature(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExplore, undo, redo, dismissAction]);

  const onPlaceSelect = (place: PlaceSearchResult, searchKind: PlaceSearchKind) => {
    if (place.type === "outdoor" && place.category) {
      flyKeyRef.current += 1;
      setFlyTo({ lng: place.lng, lat: place.lat, zoom: 15, key: flyKeyRef.current });
      setSelectedFeature({
        id: place.category,
        name: place.display_name.split("·")[0]?.trim() ?? place.display_name,
        kind: "",
        lat: place.lat,
        lng: place.lng,
      });
      setMapAction(null);
      setErr(null);
      return;
    }
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
    setSnap("peek");
  };

  const mapViewCenter = useMemo(() => {
    if (mapViewport) {
      return { lat: (mapViewport.north + mapViewport.south) / 2, lng: (mapViewport.east + mapViewport.west) / 2 };
    }
    if (waypoints.length > 0) {
      const w = waypoints[waypoints.length - 1];
      return { lat: w.lat, lng: w.lng };
    }
    return mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : undefined;
  }, [mapViewport, waypoints, mapCenter]);

  /* ─────────────── Ricerca POI ─────────────── */
  const searchPoisAtByKind = async (lng: number, lat: number, kind: PoiKindMeta) => {
    setPoiBusy(true);
    setErr(null);
    setPoiSearchBbox(null);
    setPoiSearchCenter({ lng, lat });
    try {
      const res = await fetch("/api/v2/pois/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, radiusM: POI_SEARCH_RADIUS_M, categories: [kind.category], refresh: false }),
      });
      const data = (await res.json()) as { error?: string; pois?: V2SearchPoi[]; count?: number };
      if (!res.ok) throw new Error(data.error ?? "Ricerca POI fallita");
      const found = (data.pois ?? []).filter((p) => poiMatchesKind(p.category, p.sub_kind, kind));
      setPois(found);
      if (found.length === 0) setErr(`Nessun ${kind.label.toLowerCase()} in un raggio di 3 km. Prova un'altra zona.`);
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
      if (found.length === 0) setErr("Nessun POI in un raggio di 3 km da questo punto. Prova un'altra zona o categoria.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPois([]);
    } finally {
      setPoiBusy(false);
    }
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

  const searchPoisInViewportByKind = async (kind: PoiKindMeta) => {
    setTab("nearby");
    await searchPoisInViewport([kind]);
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
    setTab("nearby");
    await searchPoisAt(lng, lat, [...CATEGORY_ORDER]);
  };

  const clearPois = () => {
    setPois([]);
    setPoiSearchCenter(null);
    setPoiSearchBbox(null);
    if (mapAction?.kind === "poi") setMapAction(null);
  };

  const onViewportChange = useCallback(
    (bbox: ViewBbox, meta?: { zoom: number }) => {
      setMapViewport(bbox);
      if (meta) setMapZoom(meta.zoom);
      if (isExplore) {
        explore.setMapBbox(bbox);
        if (meta) explore.setMapZoom(meta.zoom);
      }
    },
    [isExplore, explore.setMapBbox, explore.setMapZoom], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ─────────────── Salvataggio / export ─────────────── */
  const saveRoute = async (thenPlanOuting = false) => {
    if (!routeCoords || routeCoords.length < 2) {
      setErr("Serve almeno 2 tappe con percorso calcolato");
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
          geojson: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeCoords } },
        }),
      });
      const data = (await res.json()) as { error?: string; id?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Salvataggio fallito");
      // Si resta sulla traccia salvata: da lì si pianificano le gite.
      router.push(thenPlanOuting ? outingPlanHref(activity, data.id) : routeEditorHref(activity, data.id));
      setNotice("Traccia salvata");
      setTimeout(() => setNotice(null), 2200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const exportGpx = () => {
    if (!routeCoords || routeCoords.length < 2) return;
    const coords3d =
      profileCoords.length >= 2
        ? profileCoords.map((c) => (c[2] != null ? [c[0], c[1], Math.round(c[2])] : [c[0], c[1]]))
        : routeCoords;
    const title = name.trim() || "Percorso HMR";
    const gpx = geojsonLineToGpx(title, {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords3d },
    });
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(title)}.gpx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("GPX scaricato");
    setTimeout(() => setNotice(null), 2200);
  };

  /* ─────────────── Gita su questa traccia ─────────────── */
  const outingDraft = useOutingDraft(routeId ? routeCoords : null, outingId, searchParams.get("group"));
  /** Scheda Gita aperta su una traccia salvata: i luoghi scelti diventano soste, la traccia non cambia. */
  const outingMode = tab === "outing" && !!routeId && !isExplore;
  const saveOuting = async () => {
    if (!routeId) return;
    try {
      const id = await outingDraft.save(routeId, name.trim() || "Gita");
      router.push(outingHref(id));
    } catch {
      /* errore mostrato dal pannello */
    }
  };
  const outingOvernights = useMemo(
    () =>
      outingDraft.draft.stops
        .filter((x) => x.role === "stop" && x.overnight && x.along_km != null)
        .map((x) => ({ km: x.along_km as number, name: x.name, exposed: x.kind === "bivouac" || x.kind === "other" })),
    [outingDraft.draft.stops],
  );

  /* ─────────────── Derivati ─────────────── */
  const durationMin = estimateDurationMin(activity, lengthKm, elevGainM, elevLossM);
  const hasRoute = !!routeCoords && routeCoords.length >= 2;
  const hasProfile = profileCoords.length >= 2;
  const maxElev = useMemo(() => {
    let m = -Infinity;
    for (const c of profileCoords) if (c[2] != null && c[2] > m) m = c[2];
    return Number.isFinite(m) ? Math.round(m) : null;
  }, [profileCoords]);

  const hoverPoint = useMemo(() => {
    if (hoverKm == null || !hasProfile) return null;
    const c = coordAtKm(profileCoords, hoverKm);
    return c ? { lng: c.lng, lat: c.lat } : null;
  }, [hoverKm, hasProfile, profileCoords]);

  const pendingPoint = mapAction?.kind === "new_point" ? { lng: mapAction.lng, lat: mapAction.lat } : null;

  const insertPreview = useMemo(() => {
    if (!mapAction || mapAction.kind === "waypoint") return null;
    const lng = mapAction.kind === "poi" ? mapAction.poi.lng : mapAction.lng;
    const lat = mapAction.kind === "poi" ? mapAction.poi.lat : mapAction.lat;
    if (waypoints.length < 2) return null;
    const { index: idx, nearRoute } = insertIndexForPoint(waypoints, { lng, lat }, routeCoords);
    return { after: idx - 1, before: idx, insertAt: idx, nearRoute };
  }, [mapAction, waypoints, routeCoords]);

  const actionCenter =
    mapAction?.kind === "new_point" || mapAction?.kind === "waypoint"
      ? { lng: mapAction.lng, lat: mapAction.lat }
      : mapAction?.kind === "poi"
        ? { lng: mapAction.poi.lng, lat: mapAction.poi.lat }
        : null;

  const mapActivity = isExplore ? (explore.activity === "all" ? "hike" : explore.activity) : activity;
  const sport = SPORTS[activity];

  /** Pannelli che coprono la mappa: la camera centra nell'area libera. */
  const viewPadding = useMemo(
    () =>
      sheetH > 0
        ? { bottom: sheetH }
        : { left: DESKTOP_PANEL_SPACE, bottom: !isExplore && hasProfile ? DESKTOP_PROFILE_H : 0 },
    [sheetH, isExplore, hasProfile],
  );

  /** Zona mappa libera da pannello/profilo: lì vivono popup e banner. */
  const overlayZoneStyle: React.CSSProperties = {
    bottom: sheetH > 0 ? sheetH : !isExplore && hasProfile ? DESKTOP_PROFILE_H : 0,
  };

  /* ─────────────── Render: header / contenuti pannello ─────────────── */
  const planHeader = (
    <div>
      <div className="mb-3 hidden items-start justify-between gap-2 lg:flex">
        <div className="min-w-0">
          <p className="ui-eyebrow" style={{ color: sport.color }}>
            {sport.label}
          </p>
          <h1 className="truncate text-[18px] font-bold tracking-tight">{name.trim() || (routeId ? "Percorso" : "Nuovo percorso")}</h1>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button type="button" className="ui-icon-btn !h-9 !w-9" onClick={undo} disabled={!canUndo} title="Annulla (Ctrl+Z)" aria-label="Annulla">
            <Icon name="undo" size={18} />
          </button>
          <button type="button" className="ui-icon-btn !h-9 !w-9" onClick={redo} disabled={!canRedo} title="Ripeti (Ctrl+Shift+Z)" aria-label="Ripeti">
            <Icon name="redo" size={18} />
          </button>
        </div>
      </div>
      <V2PlaceSearch
        onSelect={onPlaceSelect}
        onCategorySearch={(kind) => void searchPoisInViewportByKind(kind)}
        mapCenter={mapViewCenter}
        viewportReady={!!mapViewport}
        poiBusy={poiBusy}
      />
      <div className="mt-3 flex items-end gap-3 px-0.5">
        {lengthKm > 0 ? (
          <>
            <StatCell label="Distanza" value={lengthKm.toFixed(lengthKm < 10 ? 2 : 1)} unit="km" />
            <StatCell label="Salita" value={elevAvailable ? Math.round(elevGainM).toLocaleString("it") : "—"} unit={elevAvailable ? "m" : undefined} />
            <StatCell label="Discesa" value={elevAvailable ? Math.round(elevLossM).toLocaleString("it") : "—"} unit={elevAvailable ? "m" : undefined} />
            <StatCell label="Tempo" value={formatDuration(durationMin)} />
          </>
        ) : (
          <p className="flex min-h-[42px] items-center gap-2 text-[12.5px] text-[color:var(--hmr-muted)]">
            {routing ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[color:var(--hmr-accent)]/25 border-t-[color:var(--hmr-accent)]" />
                Calcolo il percorso…
              </>
            ) : waypoints.length === 1 ? (
              "Partenza fissata. Tocca la mappa per aggiungere l'arrivo."
            ) : (
              "Tocca la mappa per fissare la partenza."
            )}
          </p>
        )}
      </div>
      {lengthKm > 0 ? (
        <V2RoutePopularity
          popularity={popularity}
          alternatives={alternatives}
          currentLengthKm={lengthKm}
          onPickAlternative={(alt) => {
            // Variante scelta: sostituisce la linea (le tappe restano le stesse due).
            setRouteCoords(alt.coordinates);
            setRouteTech(null);
            setLengthKm(alt.length_km);
            setPopularity(alt.popularity);
          }}
        />
      ) : null}
    </div>
  );

  const planFooterNode = (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome della traccia"
          aria-label="Nome traccia"
          className="ui-input !min-h-[38px] flex-1 !text-[13px]"
        />
        <button
          type="button"
          disabled={saveBusy || !hasRoute}
          onClick={() => void saveRoute()}
          className="ui-btn ui-btn-primary"
          title={routeId ? "Salva come nuova traccia" : "Salva la traccia"}
        >
          <Icon name="save" size={16} />
          {saveBusy ? "Salvo…" : "Salva"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex flex-1 cursor-pointer items-center gap-2 text-[12.5px] text-[color:var(--hmr-muted)]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[color:var(--hmr-accent)]"
            checked={visibility === "public"}
            onChange={(e) => setVisibility(e.target.checked ? "public" : "private")}
          />
          Pubblico
        </label>
        <button
          type="button"
          onClick={() => {
            setTab("outing");
            if (snap === "peek") setSnap("half");
          }}
          className="ui-btn ui-btn-sm ui-btn-ghost"
        >
          <Icon name="flag" size={15} />
          Gita
        </button>
        <button type="button" disabled={!hasRoute} onClick={exportGpx} className="ui-btn ui-btn-sm">
          <Icon name="download" size={15} />
          GPX
        </button>
      </div>
    </div>
  );

  const tabs: { id: PlanTab; label: string; badge?: number }[] = [
    { id: "route", label: "Traccia", badge: waypoints.length || undefined },
    { id: "outing", label: "Gita" },
    { id: "nearby", label: "Dintorni", badge: pois.length || undefined },
    { id: "conditions", label: "Condizioni", badge: routeReportWarning ?? undefined },
  ];

  const terrain = routeTech?.summary;
  const untroddenGeo = useMemo(() => untroddenFeatureCollection(popularity), [popularity]);
  // Colori applicati lato client (le risposte in cache possono avere una palette precedente).
  const routeSegments = useMemo(() => {
    if (!routeTech) return null;
    if (colorBy === "category" && routeTech.category_segments?.length) {
      return routeTech.category_segments.map((seg) => ({ ...seg, color: WAY_CATEGORY_COLORS[seg.category ?? "other"] }));
    }
    return routeTech.colored_segments.map((seg) => ({ ...seg, color: SURFACE_COLORS[seg.surface] }));
  }, [routeTech, colorBy]);
  const categoryRows = useMemo(() => {
    const km = terrain?.category_km ?? {};
    const total = Object.values(km).reduce((a, b) => a + (b ?? 0), 0);
    if (total <= 0) return [];
    return WAY_CATEGORY_ORDER.filter((c) => (km[c] ?? 0) / total >= 0.005).map((c) => ({
      cat: c,
      km: km[c] ?? 0,
      pct: ((km[c] ?? 0) / total) * 100,
    }));
  }, [terrain]);
  const surfaceKinds = ["asphalt", "gravel", "single", "unknown"] as TrackSurfaceKind[];

  const planBody = (
    <div>
      <div
        className="ui-seg sticky top-0 z-10 mb-3 mt-0.5 backdrop-blur"
        role="tablist"
        aria-label="Sezioni planner"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              if (snap === "peek") setSnap("half");
            }}
          >
            {t.label}
            {t.badge ? (
              <span
                className={`min-w-[18px] rounded-full px-1.5 text-[10.5px] font-bold leading-[18px] ${
                  t.id === "conditions"
                    ? "bg-[color:var(--hmr-warn)]/10 text-[color:var(--hmr-warn)]"
                    : "bg-[color:var(--hmr-accent-dim)] text-[color:var(--hmr-accent)]"
                }`}
              >
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "route" ? (
        <div className="v2-anim-in">
          <SectionTitle>Attività</SectionTitle>
          <V2SportChips value={activity} onChange={(a) => setActivity(a)} />
          {importedTrack && hasRoute ? (
            <p className="mt-2 text-[12px] text-[color:var(--hmr-muted)]">
              Traccia importata da GPX: resta com&apos;è. Se aggiungi due tappe sulla mappa viene sostituita da un percorso calcolato.
            </p>
          ) : null}

          <SectionTitle>Percorso</SectionTitle>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Preferenza di percorso">
            {(["recommended", "shortest", "quiet"] as RoutePreference[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={preference === p}
                onClick={() => setPreference(p)}
                className="ui-chip"
                title={PREFERENCE_LABELS[p].hint}
              >
                {sport.usesCyclingOrs ? PREFERENCE_LABELS[p].bike : PREFERENCE_LABELS[p].foot}
              </button>
            ))}
          </div>
          {activity === "road" ? (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={preferCycleways} onChange={togglePreferCycleways} />
              <span title="Usa le piste ciclabili asfaltate quando non allungano più del 25%">Preferisci ciclabili</span>
            </label>
          ) : null}

          {hasProfile ? (
            <div className="mt-4 h-[128px] lg:hidden">
              <ElevationProfile coords={profileCoords} hoverKm={hoverKm} onHoverKm={setHoverKm} />
            </div>
          ) : null}

          <SectionTitle
            right={
              <div className="flex gap-0.5">
                <button
                  type="button"
                  className="ui-icon-btn !h-8 !w-8 lg:!hidden"
                  onClick={undo}
                  disabled={!canUndo}
                  aria-label="Annulla"
                  title="Annulla"
                >
                  <Icon name="undo" size={16} />
                </button>
                <button
                  type="button"
                  className="ui-icon-btn !h-8 !w-8"
                  onClick={reverseRoute}
                  disabled={waypoints.length < 2}
                  title="Inverti senso"
                  aria-label="Inverti senso"
                >
                  <Icon name="swap" size={16} />
                </button>
                <button
                  type="button"
                  className="ui-icon-btn !h-8 !w-8"
                  onClick={closeLoop}
                  disabled={waypoints.length < 2}
                  title="Chiudi ad anello (torna al via)"
                  aria-label="Chiudi ad anello"
                >
                  <Icon name="loop" size={16} />
                </button>
                <button
                  type="button"
                  className="ui-icon-btn !h-8 !w-8 hover:!text-[color:var(--hmr-danger)]"
                  onClick={clearAll}
                  disabled={waypoints.length === 0 && pois.length === 0}
                  title="Pulisci tutto"
                  aria-label="Pulisci tutto"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            }
          >
            Tappe
          </SectionTitle>
          <V2WaypointList
            waypoints={waypoints}
            onReorder={reorderWaypoints}
            onRemove={removeWaypoint}
            onSelect={(i) => {
              setSelectedWaypointIndex(i);
              const wp = waypoints[i];
              if (wp) {
                setMapAction({ kind: "waypoint", index: i, lng: wp.lng, lat: wp.lat });
                flyKeyRef.current += 1;
                setFlyTo({ lng: wp.lng, lat: wp.lat, key: flyKeyRef.current });
              }
            }}
            selectedIndex={selectedWaypointIndex}
          />

          {hasRoute && (terrain || maxElev != null) ? (
            <>
              <SectionTitle
                right={
                  terrain ? (
                    <div className="flex gap-3 text-[12px]" role="radiogroup" aria-label="Colora percorso">
                      {(["category", "surface"] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={colorBy === c}
                          onClick={() => setColorBy(c)}
                          className={colorBy === c ? "font-semibold text-[color:var(--hmr-text)] underline underline-offset-4" : "text-[color:var(--hmr-faint)] hover:text-[color:var(--hmr-text)]"}
                        >
                          {c === "category" ? "Per tipo" : "Per fondo"}
                        </button>
                      ))}
                    </div>
                  ) : null
                }
              >
                Terreno
              </SectionTitle>
              <div className="rounded-lg border border-[color:var(--hmr-border)] p-3">
                {terrain && colorBy === "category" && categoryRows.length > 0 ? (
                  <ul className="space-y-1.5">
                    {categoryRows.map((r) => (
                      <li key={r.cat} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[12.5px]">
                        <span className="flex items-center gap-2">
                          <span className="h-[3px] w-4 rounded" style={{ background: WAY_CATEGORY_COLORS[r.cat] }} />
                          {WAY_CATEGORY_LABELS[r.cat]}
                        </span>
                        <span className="tabular-nums text-[color:var(--hmr-muted)]">
                          {r.km.toFixed(1)} km · <b className="font-semibold text-[color:var(--hmr-text)]">{r.pct.toFixed(0)}%</b>
                        </span>
                        <span className="col-span-2 h-1 overflow-hidden rounded bg-[color:var(--hmr-elev)]">
                          <span className="block h-full" style={{ width: `${r.pct}%`, background: WAY_CATEGORY_COLORS[r.cat] }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {terrain && (colorBy === "surface" || categoryRows.length === 0) ? (
                  <>
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-[color:var(--hmr-elev)]">
                      {surfaceKinds.map((k) =>
                        terrain.surface_pct[k] >= 0.5 ? (
                          <span key={k} style={{ width: `${terrain.surface_pct[k]}%`, background: SURFACE_COLORS[k] }} />
                        ) : null,
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {surfaceKinds.map((k) =>
                        terrain.surface_pct[k] >= 1 ? (
                          <span key={k} className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--hmr-muted)]">
                            <span className="h-2 w-2 rounded-full" style={{ background: SURFACE_COLORS[k] }} />
                            {formatTerrainIt(k)}
                            <b className="font-semibold text-[color:var(--hmr-text)]">{terrain.surface_pct[k].toFixed(0)}%</b>
                          </span>
                        ) : null,
                      )}
                    </div>
                  </>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[color:var(--hmr-muted)]">
                  {maxElev != null ? (
                    <span>
                      Quota max <b className="font-semibold text-[color:var(--hmr-text)]">{maxElev.toLocaleString("it")} m</b>
                    </span>
                  ) : null}
                  {terrain?.max_difficulty ? (
                    <span>
                      Difficoltà max <b className="font-semibold text-[color:var(--hmr-text)]">{terrain.max_difficulty}</b>
                    </span>
                  ) : null}
                  {terrain?.max_steepness ? (
                    <span>
                      Pendenza max <b className="font-semibold text-[color:var(--hmr-text)]">{terrain.max_steepness}</b>
                    </span>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {routeReportWarning != null ? (
            <button
              type="button"
              onClick={() => setTab("conditions")}
              className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-[color:var(--hmr-warn)]/40 bg-[color:var(--hmr-warn)]/10 px-3 py-2.5 text-left text-[12.5px] text-[color:var(--hmr-warn)]"
            >
              <Icon name="alert" size={18} className="shrink-0 text-[color:var(--hmr-warn)]" />
              <span>
                <b>{routeReportWarning}</b> segnalazion{routeReportWarning === 1 ? "e" : "i"} entro 300 m dal percorso
              </span>
            </button>
          ) : null}

          <div className="lg:hidden">
            <SectionTitle>Salva ed esporta</SectionTitle>
            {planFooterNode}
          </div>

          {hasRoute ? (
            <>
              <SectionTitle>Lungo il percorso</SectionTitle>
              <V2AlongRoutePanel
                routeCoords={routeCoords}
                onSelect={(it) => {
                  setSelectedFeature({ id: it.id, name: it.name, kind: it.kindLabel, lat: it.lat, lng: it.lng });
                  flyKeyRef.current += 1;
                  setFlyTo({ lng: it.lng, lat: it.lat, zoom: 15, key: flyKeyRef.current });
                }}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "outing" ? (
        <div className="v2-anim-in">
          <p className="mt-1 text-[12.5px] text-[color:var(--hmr-muted)]">
            La <b>traccia</b> è il percorso, riusabile. La <b>gita</b> è un&apos;uscita su quella traccia: data, compagni, soste,
            notti fuori e poi il resoconto.
          </p>
          <Link href={outingNewHref(activity)} className="ui-btn ui-btn-sm mt-2 w-full">
            <Icon name="plus" size={15} />
            Aggiungi una gita già fatta (GPX + racconto)
          </Link>

          {routeId ? (
            <>
              <V2OutingList routeId={routeId} className="mt-3" />
              <SectionTitle>{outingId ? "Modifica gita" : "Pianifica una gita su questa traccia"}</SectionTitle>
              <V2OutingPlanPanel
                api={outingDraft}
                hasRoute={hasRoute}
                profile={hasProfile ? profileCoords : null}
                activity={activity}
                onFocusStop={(lng, lat) => {
                  flyKeyRef.current += 1;
                  setFlyTo({ lng, lat, zoom: 15, key: flyKeyRef.current });
                }}
              />
              <button
                type="button"
                disabled={outingDraft.saving || !hasRoute}
                onClick={() => void saveOuting()}
                className="ui-btn ui-btn-primary mt-4 w-full"
              >
                <Icon name="save" size={16} />
                {outingDraft.saving ? "Salvo…" : outingId ? "Salva modifiche alla gita" : "Salva gita"}
              </button>
            </>
          ) : (
            <div className="mt-3 rounded-xl border border-[color:var(--hmr-border)]/70 p-3">
              <p className="text-[12.5px]">
                Per pianificare una gita serve una traccia salvata.{" "}
                {hasRoute ? "Salva questa e continua con la gita." : "Disegna la traccia nella scheda Traccia, poi salvala."}
              </p>
              <button
                type="button"
                disabled={saveBusy || !hasRoute}
                onClick={() => void saveRoute(true)}
                className="ui-btn ui-btn-primary ui-btn-sm mt-2 w-full"
              >
                <Icon name="save" size={15} />
                {saveBusy ? "Salvo…" : "Salva traccia e pianifica gita"}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {tab === "nearby" ? (
        <div className="v2-anim-in">
          {groupCounts.length > 0 || outdoorBusy ? (
            <>
              <SectionTitle>Sulla mappa</SectionTitle>
              <V2AreaDataPanel counts={groupCounts} enabledGroups={outdoorGroupFilter} onToggleGroup={toggleOutdoorGroup} busy={outdoorBusy} />
            </>
          ) : null}

          <SectionTitle right={poiBusy ? <span className="text-[11px] text-[color:var(--hmr-muted)]">Cerco…</span> : null}>
            Cerca nell&apos;area visibile
          </SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {VIEWPORT_SEARCH_KINDS.map((k) => {
              const on = selectedViewportKinds.has(k.id);
              return (
                <button
                  key={k.id}
                  type="button"
                  disabled={poiBusy}
                  onClick={() => toggleViewportKind(k.id)}
                  aria-pressed={on}
                  className="ui-chip"
                  style={on ? { borderColor: `${k.color}99`, background: `${k.color}22`, color: k.color } : undefined}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: k.color }} />
                  {k.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={poiBusy || !mapViewport || selectedViewportKinds.size === 0}
            onClick={runViewportSearch}
            className="ui-btn ui-btn-primary mt-2.5 w-full"
          >
            <Icon name="search" size={16} />
            Cerca qui
          </button>
          <p className="mt-1.5 text-[11.5px] text-[color:var(--hmr-faint)]">Inquadra la zona (max ~55 km di lato), poi cerca.</p>

          <SectionTitle>
            Vicino a {actionCenter ? "punto selezionato" : waypoints.length > 0 ? "ultima tappa" : "centro mappa"}
          </SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {POI_RADIUS_PRESETS.map((k) => (
              <button
                key={k.id}
                type="button"
                disabled={poiBusy}
                onClick={() => {
                  const center =
                    actionCenter ??
                    (waypoints.length > 0 ? waypoints[waypoints.length - 1] : mapViewCenter ?? DEFAULT_MAP_VIEW_CENTER);
                  void searchPoisAtByKind(center.lng, center.lat, k);
                }}
                className="ui-chip"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: k.color }} />
                {k.label}
              </button>
            ))}
            <button
              type="button"
              disabled={poiBusy}
              onClick={() => {
                const center =
                  actionCenter ??
                  (waypoints.length > 0 ? waypoints[waypoints.length - 1] : mapViewCenter ?? DEFAULT_MAP_VIEW_CENTER);
                void searchPoisAt(center.lng, center.lat, [...CATEGORY_ORDER]);
              }}
              className="ui-chip"
            >
              Tutto entro 3 km
            </button>
          </div>

          {pois.length > 0 ? (
            <>
              <SectionTitle
                right={
                  <button type="button" onClick={clearPois} className="text-[12px] font-semibold text-[color:var(--hmr-accent)]">
                    Nascondi
                  </button>
                }
              >
                Risultati · {pois.length}
              </SectionTitle>
              <ul className="-mx-1 space-y-0.5">
                {pois.slice(0, 40).map((p) => {
                  const kindMeta = resolvePoiKind(p.category, p.sub_kind);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setMapAction({ kind: "poi", poi: p });
                          flyKeyRef.current += 1;
                          setFlyTo({ lng: p.lng, lat: p.lat, zoom: Math.max(14, mapZoom), key: flyKeyRef.current });
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[color:var(--hmr-elev)]"
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70" style={{ background: kindMeta.color }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">{p.name ?? kindMeta.label}</span>
                          <span className="block truncate text-[11.5px] text-[color:var(--hmr-faint)]">{kindMeta.label}</span>
                        </span>
                        <Icon name="chevronRight" size={16} className="text-[color:var(--hmr-faint)]" />
                      </button>
                    </li>
                  );
                })}
                {pois.length > 40 ? (
                  <li className="px-2 py-1 text-[12px] text-[color:var(--hmr-faint)]">+ altri {pois.length - 40} sulla mappa</li>
                ) : null}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "conditions" ? (
        <div className="v2-anim-in">
          {routeReportWarning != null ? (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[color:var(--hmr-warn)]/40 bg-[color:var(--hmr-warn)]/10 px-3 py-2.5 text-[12.5px] text-[color:var(--hmr-warn)]">
              <Icon name="alert" size={18} className="mt-px shrink-0 text-[color:var(--hmr-warn)]" />
              <span>
                <b>{routeReportWarning}</b> segnalazion{routeReportWarning === 1 ? "e attiva" : "i attive"} entro 300 m dal percorso.
                Controlla i punti colorati sulla mappa prima di partire.
              </span>
            </div>
          ) : null}
          <SectionTitle>Meteo {hasRoute ? "alla partenza" : "al centro mappa"}</SectionTitle>
          <V2ConditionsPanel
            lat={(hasRoute ? routeCoords?.[0]?.[1] : null) ?? mapViewCenter?.lat ?? null}
            lng={(hasRoute ? routeCoords?.[0]?.[0] : null) ?? mapViewCenter?.lng ?? null}
            activity={activity}
            profile={hasRoute ? profileCoords : null}
          />
          {hasProfile ? (
            <>
              <SectionTitle>Meteo di precisione lungo la traccia</SectionTitle>
              <V2PrecisionForecast
                activity={activity}
                date={routeId ? outingDraft.draft.outing_date || null : null}
                startTime={routeId ? outingDraft.draft.start_time || null : null}
                profile={profileCoords}
                overnights={routeId ? outingOvernights : undefined}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {err ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-[color:var(--hmr-danger)]/10 px-3 py-2 text-[12.5px] text-[color:var(--hmr-danger)]">
          <Icon name="alert" size={16} className="mt-px shrink-0" />
          {err}
        </p>
      ) : null}
    </div>
  );

  const exploreHeader = (
    <div>
      <p className="ui-eyebrow">Esplora</p>
      <h1 className="text-[18px] font-bold tracking-tight">Percorsi e gite</h1>
      <p className="mt-0.5 text-[12.5px] text-[color:var(--hmr-muted)]">Itinerari della community sulla mappa · {explore.scopeLabel}</p>
    </div>
  );

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute inset-0">
        <V2PlanMap
          waypoints={isExplore ? [] : waypoints}
          routeCoords={isExplore ? null : routeCoords}
          routeColoredSegments={isExplore ? null : routeSegments}
          pois={isExplore ? [] : pois}
          poiSearchCenter={isExplore ? null : poiSearchCenter}
          poiSearchBbox={isExplore ? null : poiSearchBbox}
          pendingPoint={isExplore ? null : pendingPoint}
          onMapInteraction={isExplore ? onExploreMapInteraction : onMapInteraction}
          onWaypointMove={isExplore ? undefined : moveWaypoint}
          onRouteDragStart={isExplore ? undefined : startRouteDrag}
          onViewportChange={onViewportChange}
          initialCenter={mapCenter}
          flyTo={isExplore ? explore.flyTo : flyTo}
          fitTo={isExplore ? null : fitTo}
          hoverPoint={isExplore ? null : hoverPoint}
          viewPadding={viewPadding}
          busy={routing || poiBusy || (isExplore && explore.busy)}
          mapSport={mapActivity}
          reportsGeoJson={isExplore ? (explore.reportsVisible ? explore.reportsGeoJson : null) : reportsGeoJson}
          featuresGeoJson={isExplore ? null : featuresGeoJson}
          pickOutdoorFeatures
          pickMapLabels={!isExplore || !explore.reportMode}
          untroddenGeoJson={isExplore ? null : untroddenGeo}
          exploreGeoJson={isExplore ? explore.displayGeoJson : undefined}
          routeMarkersGeoJson={isExplore ? explore.routeMarkersGeoJson : undefined}
          photosGeoJson={isExplore ? (explore.photosVisible ? explore.photosGeoJson : null) : undefined}
          onRouteSelect={isExplore ? explore.setSelectedRouteId : undefined}
          showWaypoints={!isExplore}
          outingStopsGeoJson={outingMode ? outingDraft.stopsGeoJson : null}
          slopeVisible={isExplore && explore.activity === "ski" && explore.slopeVisible}
          slopeOpacity={SKI_SLOPE_DEFAULT_OPACITY}
          avalancheGeoJson={isExplore ? explore.avalancheGeoJson : undefined}
          avalancheVisible={isExplore && explore.activity === "ski" && explore.avalancheVisible}
          avalancheOpacity={SKI_AVALANCHE_DEFAULT_OPACITY}
          terrain3d={isExplore && explore.activity === "ski"}
          onReportSelect={
            isExplore
              ? (reportId) => {
                  const f = explore.reportsGeoJson?.features.find(
                    (x) => (x.properties as { reportId?: string }).reportId === reportId,
                  );
                  if (!f) return;
                  const p = f.properties as {
                    reportId: string;
                    kind: import("@/lib/field-reports").FieldReportKind;
                    kindLabel: string;
                    author: string;
                    description: string;
                    verified: boolean;
                    confirmationCount: number;
                    photoUrl?: string | null;
                  };
                  explore.setSelectedReport({
                    id: p.reportId,
                    author: p.author,
                    kind: p.kind,
                    kind_label: p.kindLabel,
                    description: p.description,
                    confirmation_count: p.confirmationCount,
                    verified: p.verified,
                    status: "active",
                    photo_url: p.photoUrl ?? null,
                  });
                }
              : undefined
          }
        />
      </div>

      <MapPanel
        header={isExplore ? exploreHeader : planHeader}
        footer={isExplore ? undefined : planFooterNode}
        snap={snap}
        onSnapChange={setSnap}
        peekHeight={isExplore ? 112 : 150}
        onMobileHeight={setSheetH}
      >
        {isExplore ? (
          <div className="flex flex-col gap-3 pt-1">
            <V2ExploreAside explore={explore} />
          </div>
        ) : (
          planBody
        )}
      </MapPanel>

      {/* Profilo altimetrico agganciato in basso (desktop) */}
      {!isExplore && hasProfile ? (
        <div
          className="absolute bottom-0 right-0 z-20 hidden border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] px-3 pt-2 lg:block"
          style={{ left: DESKTOP_PANEL_SPACE, height: DESKTOP_PROFILE_H }}
        >
          <ElevationProfile coords={profileCoords} hoverKm={hoverKm} onHoverKm={setHoverKm} />
        </div>
      ) : null}

      {/* Zona overlay: area di mappa libera (sopra il foglio mobile / a destra del pannello desktop) */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-40 lg:left-[384px]"
        style={overlayZoneStyle}
      >
        {notice ? (
          <div className="v2-anim-in absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-[color:var(--hmr-text)] px-4 py-2 text-[12.5px] font-semibold text-[color:var(--hmr-bg)] shadow-lg">
            {notice}
          </div>
        ) : null}

        {!isExplore && mapAction && mapAction.kind !== "poi" ? (
          <div className="absolute inset-x-2 bottom-2 flex justify-center sm:bottom-3">
            <div className="ui-glass v2-anim-in pointer-events-auto w-full max-w-[420px] rounded-lg p-3">
              {mapAction.kind === "new_point" ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-bold">Punto selezionato</p>
                      <p className="truncate text-[11.5px] text-[color:var(--hmr-muted)]">
                        {mapAction.lat.toFixed(5)}, {mapAction.lng.toFixed(5)}
                        {insertPreview ? ` · tra tappa ${insertPreview.after + 1} e ${insertPreview.before + 1}` : ""}
                      </p>
                    </div>
                    <button type="button" onClick={dismissAction} className="ui-icon-btn !h-8 !w-8 shrink-0" aria-label="Annulla">
                      <Icon name="x" size={17} />
                    </button>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <button
                      type="button"
                      onClick={() => setNewDestination(mapAction.lng, mapAction.lat, mapAction.label)}
                      className={`ui-btn ui-btn-sm ${insertPreview?.nearRoute ? "" : "ui-btn-primary"}`}
                    >
                      <Icon name="flag" size={15} />
                      Arrivo
                    </button>
                    <button
                      type="button"
                      onClick={() => insertInRoute(mapAction.lng, mapAction.lat, mapAction.label)}
                      disabled={waypoints.length < 2}
                      className={`ui-btn ui-btn-sm ${insertPreview?.nearRoute ? "ui-btn-primary" : ""}`}
                    >
                      <Icon name="plus" size={15} />
                      Tappa
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsStart(mapAction.lng, mapAction.lat, mapAction.label)}
                      className="ui-btn ui-btn-sm"
                    >
                      <Icon name="pin" size={15} />
                      Partenza
                    </button>
                    <button
                      type="button"
                      disabled={poiBusy}
                      onClick={() => void searchPoisNearby(mapAction.lng, mapAction.lat)}
                      className="ui-btn ui-btn-sm"
                    >
                      <Icon name="search" size={15} />
                      Vicino
                    </button>
                  </div>
                  {outingMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        outingDraft.addStop({ kind: "other", name: mapAction.label ?? "", lng: mapAction.lng, lat: mapAction.lat });
                        dismissAction();
                      }}
                      className="ui-btn ui-btn-sm ui-btn-primary mt-2 w-full"
                    >
                      <Icon name="plus" size={15} />
                      Sosta della gita (la traccia non cambia)
                    </button>
                  ) : null}
                </>
              ) : null}

              {mapAction.kind === "waypoint" ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-bold">
                        Tappa {mapAction.index + 1}
                        {waypoints[mapAction.index]?.label ? ` · ${waypoints[mapAction.index].label}` : ""}
                      </p>
                      <p className="text-[11.5px] text-[color:var(--hmr-muted)]">Trascinala sulla mappa per spostarla</p>
                    </div>
                    <button type="button" onClick={dismissAction} className="ui-icon-btn !h-8 !w-8 shrink-0" aria-label="Chiudi">
                      <Icon name="x" size={17} />
                    </button>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={poiBusy}
                      onClick={() => void searchPoisNearby(mapAction.lng, mapAction.lat)}
                      className="ui-btn ui-btn-sm"
                    >
                      <Icon name="search" size={15} />
                      Cosa c&apos;è vicino
                    </button>
                    <button type="button" onClick={() => removeWaypoint(mapAction.index)} className="ui-btn ui-btn-sm ui-btn-danger">
                      <Icon name="trash" size={15} />
                      Elimina
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {placeTarget && selectedPlace ? (
          <V2PoiBanner
            target={placeTarget}
            sport={mapActivity}
            onClose={() => setSelectedPlace(null)}
            onInsertInRoute={
              !isExplore && waypoints.length >= 2
                ? () => {
                    insertInRoute(selectedPlace.lng, selectedPlace.lat, selectedPlace.name);
                    setSelectedPlace(null);
                  }
                : undefined
            }
            onSetDestination={
              !isExplore
                ? () => {
                    setNewDestination(selectedPlace.lng, selectedPlace.lat, selectedPlace.name);
                    setSelectedPlace(null);
                  }
                : undefined
            }
            destinationLabel={waypoints.length === 0 ? "Parti da qui" : "Arrivo qui"}
            onAddToOuting={
              outingMode
                ? () => {
                    outingDraft.addStop({
                      kind: "viewpoint",
                      name: selectedPlace.name,
                      lng: selectedPlace.lng,
                      lat: selectedPlace.lat,
                      ref: `place:${selectedPlace.id}`,
                    });
                    setSelectedPlace(null);
                  }
                : undefined
            }
          />
        ) : null}

        {!isExplore && !selectedPlace && mapAction?.kind === "poi" && poiTarget ? (
          <V2PoiBanner
            target={poiTarget}
            sport={mapActivity}
            onClose={dismissAction}
            onInsertInRoute={() => insertInRoute(mapAction.poi.lng, mapAction.poi.lat, mapAction.poi.name ?? mapAction.poi.sub_kind)}
            onSetDestination={() => setNewDestination(mapAction.poi.lng, mapAction.poi.lat, mapAction.poi.name ?? mapAction.poi.sub_kind)}
            onAddToOuting={
              outingMode
                ? () => {
                    const poi = mapAction.poi;
                    outingDraft.addStop({
                      kind: stopKindFromPoiCategory(poi.category, poi.sub_kind),
                      name: poi.name ?? "",
                      lng: poi.lng,
                      lat: poi.lat,
                      ref: `poi:${poi.id}`,
                    });
                    dismissAction();
                  }
                : undefined
            }
          />
        ) : null}

        {!isExplore && selectedFeature ? (
          <div className="absolute inset-x-2 bottom-2 flex justify-center sm:bottom-3">
            <div className="pointer-events-auto max-h-[60vh] w-full max-w-md overflow-y-auto">
              <V2FeatureSheet
                pick={selectedFeature}
                onClose={() => setSelectedFeature(null)}
                onFlyTo={(lng, lat) => {
                  flyKeyRef.current += 1;
                  setFlyTo({ lng, lat, zoom: 15, key: flyKeyRef.current });
                }}
              />
              <div className="ui-glass mt-1.5 grid grid-cols-2 gap-2 rounded-lg p-2">
                <button
                  type="button"
                  className="ui-btn ui-btn-primary ui-btn-sm"
                  onClick={() => {
                    setNewDestination(selectedFeature.lng, selectedFeature.lat, selectedFeature.name);
                    setSelectedFeature(null);
                  }}
                >
                  <Icon name="flag" size={15} />
                  {waypoints.length === 0 ? "Parti da qui" : "Arrivo qui"}
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-sm"
                  disabled={waypoints.length < 2}
                  onClick={() => {
                    insertInRoute(selectedFeature.lng, selectedFeature.lat, selectedFeature.name);
                    setSelectedFeature(null);
                  }}
                >
                  <Icon name="plus" size={15} />
                  Aggiungi come tappa
                </button>
                {outingMode ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary ui-btn-sm col-span-2"
                    onClick={() => {
                      outingDraft.addStop({
                        kind: stopKindFromOutdoorKind(selectedFeature.kind),
                        name: selectedFeature.name,
                        lng: selectedFeature.lng,
                        lat: selectedFeature.lat,
                        ref: `feature:${selectedFeature.id}`,
                      });
                      setSelectedFeature(null);
                    }}
                  >
                    <Icon name="plus" size={15} />
                    Aggiungi alla gita (sosta o pernotto)
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {isExplore && explore.selectedRoute ? (
          <div className="absolute inset-x-2 bottom-2 flex justify-center sm:bottom-3">
            <div className="pointer-events-auto relative w-full max-w-lg">
              <V2SkiRouteBanner
                name={explore.selectedRoute.name}
                lengthKm={explore.selectedRoute.length_km}
                elevGainM={explore.selectedRoute.elev_gain_m}
                elevLossM={explore.selectedRoute.elev_loss_m}
                owner={explore.selectedRoute.owner}
                source={explore.selectedRoute.source}
                sourceUrl={explore.selectedRoute.source_url}
                license={explore.selectedRoute.license}
                facts={explore.selectedFacts}
                avalancheNote={explore.selectedAvalancheNote}
                onOpen={() => router.push(routeEditorHref(explore.selectedRoute!.activity, explore.selectedRoute!.id))}
                onRegisterOuting={() =>
                  router.push(outingPlanHref(explore.selectedRoute!.activity, explore.selectedRoute!.id))
                }
                onDismiss={() => explore.setSelectedRouteId(null)}
              />
            </div>
          </div>
        ) : null}
      </div>

      {isExplore && explore.createReportAt ? (
        <V2ReportCreateSheet
          lng={explore.createReportAt.lng}
          lat={explore.createReportAt.lat}
          onClose={() => explore.setCreateReportAt(null)}
          onCreated={() => {
            explore.setCreateReportAt(null);
            if (explore.mapBbox) void explore.loadOverlays(explore.mapBbox);
          }}
        />
      ) : null}

      {isExplore && explore.selectedReport ? (
        <V2ReportSheet
          report={explore.selectedReport}
          isSelf={explore.selectedReport.author === username}
          onClose={() => explore.setSelectedReport(null)}
          onConfirm={async (id) => {
            await fetch(`/api/v2/reports/${encodeURIComponent(id)}/confirm`, { method: "POST" });
            explore.setSelectedReport(null);
            if (explore.mapBbox) void explore.loadOverlays(explore.mapBbox);
          }}
          onResolve={async (id) => {
            await fetch(`/api/v2/reports/${encodeURIComponent(id)}/resolve`, { method: "POST" });
            explore.setSelectedReport(null);
            if (explore.mapBbox) void explore.loadOverlays(explore.mapBbox);
          }}
        />
      ) : null}

      {isExplore && explore.showPhotoCapture ? (
        <V2PhotoCapture
          onClose={() => explore.setShowPhotoCapture(false)}
          onUploaded={() => {
            explore.setShowPhotoCapture(false);
            if (explore.mapBbox) void explore.loadOverlays(explore.mapBbox);
          }}
        />
      ) : null}
    </div>
  );
}
