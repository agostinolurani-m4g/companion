"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PoiCategory } from "@/lib/db";
import { resolvePoiKind } from "@/lib/categories";
import { DEFAULT_MAP_VIEW_CENTER } from "@/lib/map-defaults";
import {
  applyRelief,
  baseMapDef,
  defaultBaseForSport,
  isBaseDark,
  type MapMode,
  isWinterTopo,
  OSM_RASTER_STYLE,
  styleForBaseId,
  type BaseStyleId,
} from "@/lib/map/topo-style";
import { AVAILABLE_OVERLAYS } from "@/lib/map/overlay-urls";
import type { MapOverlayId } from "@/lib/sports";
import { SPORTS } from "@/lib/sports";
import { SKI_AVALANCHE_DEFAULT_OPACITY, SKI_SLOPE_DEFAULT_OPACITY } from "@/lib/ski-overlays";
import Icon from "@/components/v2/ui/Icon";
import { EMPTY_FC } from "./constants";
import { circlePolygon, setGeoJson } from "./geojson";
import { attachGlobalHandlers, bindLayerHandlers } from "./mapHandlers";
import { addOverlaySourcesAndLayers, setSportOverlayVisibility } from "./overlayLayers";
import { applyTerrain3d } from "./terrain";
import type { V2PlanMapProps } from "./types";
import MapLayersPanel from "./MapLayersPanel";
import { ensureContourLayers, setContourLayerVisible } from "./contourLayer";
import { useMapPrefs } from "./useMapPrefs";
import { ensureHeatLayers, HEAT_SOURCE, setGeoJsonData, setHeatVisible, UNTRODDEN_SOURCE, type HeatScope } from "./heatmapLayer";
import { heatSportFamily } from "@/lib/activities/sport-family";
import { useV2Theme } from "@/components/v2/ui/theme";
import { attachMapImages } from "./mapImages";
import { rainViewerTilePath, rainViewerTilesUrl } from "@/lib/map/rainviewer";

type GeoState = "off" | "locating" | "on" | "error";

const AVAILABLE_OVERLAY_IDS = new Set(AVAILABLE_OVERLAYS.map((o) => o.id));

function bboxOf(map: MaplibreMap) {
  const b = map.getBounds();
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
}

export default function MapCore({
  waypoints,
  routeCoords,
  routeColoredSegments,
  pois,
  poiSearchCenter,
  poiSearchBbox,
  pendingPoint,
  onMapInteraction,
  onWaypointMove,
  onRouteDragStart,
  onViewportChange,
  initialCenter,
  flyTo,
  fitTo,
  hoverPoint,
  busy = false,
  slopeVisible = false,
  slopeOpacity = SKI_SLOPE_DEFAULT_OPACITY,
  avalancheGeoJson,
  avalancheVisible = false,
  avalancheOpacity = SKI_AVALANCHE_DEFAULT_OPACITY,
  showWaypoints = true,
  exploreGeoJson,
  photosGeoJson,
  outingStopsGeoJson,
  reportsGeoJson,
  onRouteSelect,
  onReportSelect,
  routeMarkersGeoJson,
  terrain3d = false,
  mapSport,
  sportOverlays: sportOverlaysProp,
  onSportOverlaysChange,
  featuresGeoJson,
  pickOutdoorFeatures = false,
  pickMapLabels = false,
  controlsTopOffset = 0,
  viewPadding,
  untroddenGeoJson,
}: V2PlanMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const layersReadyRef = useRef(false);
  const globalHandlersAttachedRef = useRef(false);
  const layerHandlerCleanupRef = useRef<(() => void) | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const userPosRef = useRef<{ lng: number; lat: number; acc: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [view3d, setView3d] = useState(terrain3d);
  const view3dRef = useRef(terrain3d);
  const [layersOpen, setLayersOpen] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [geo, setGeo] = useState<GeoState>("off");
  const [tilesLoading, setTilesLoading] = useState(false);
  const { prefs, update: updatePrefs, loaded: prefsLoaded } = useMapPrefs();

  const { theme: appTheme, setTheme: setAppTheme } = useV2Theme();
  const baseStyle: BaseStyleId = prefs.base ?? defaultBaseForSport(mapSport);
  const mapMode: MapMode = prefs.mapMode === "auto" ? appTheme : prefs.mapMode;
  const baseDef = baseMapDef(baseStyle);
  const baseDark = isBaseDark(baseStyle, mapMode);
  const styleKey = `${baseStyle}:${baseDef.supportsDark ? mapMode : "fixed"}`;
  const appliedBaseRef = useRef<string | null>(null);

  /* ── refs per i callback (evita ricreare la mappa) ── */
  const onInteractionRef = useRef(onMapInteraction);
  const onWaypointMoveRef = useRef(onWaypointMove);
  const onRouteDragStartRef = useRef(onRouteDragStart);
  const onViewportChangeRef = useRef(onViewportChange);
  const poisRef = useRef(pois);
  const waypointsRef = useRef(waypoints);
  const dragRef = useRef<{
    index: number;
    startX: number;
    startY: number;
    moved: boolean;
    fromRoute?: { lng: number; lat: number };
  } | null>(null);
  const suppressClickRef = useRef(false);
  const onRouteSelectRef = useRef(onRouteSelect);
  const onReportSelectRef = useRef(onReportSelect);
  const outdoorFeaturesRef = useRef<GeoJSON.FeatureCollection | null>(featuresGeoJson ?? null);
  const allowOutdoorPickRef = useRef(pickOutdoorFeatures);
  const allowLabelPickRef = useRef(pickMapLabels);

  useEffect(() => {
    onRouteSelectRef.current = onRouteSelect;
    onReportSelectRef.current = onReportSelect;
    onInteractionRef.current = onMapInteraction;
    onWaypointMoveRef.current = onWaypointMove;
    onRouteDragStartRef.current = onRouteDragStart;
    onViewportChangeRef.current = onViewportChange;
    poisRef.current = pois;
    outdoorFeaturesRef.current = featuresGeoJson ?? null;
    allowOutdoorPickRef.current = pickOutdoorFeatures;
    allowLabelPickRef.current = pickMapLabels;
    waypointsRef.current = waypoints;
  });

  useEffect(() => {
    setView3d(terrain3d);
  }, [terrain3d]);
  useEffect(() => {
    view3dRef.current = view3d;
  }, [view3d]);

  /* ── Sovrapposizioni: controllate dal parent se fornite, altrimenti default sport ── */
  const recommended = useMemo<MapOverlayId[]>(
    () => (mapSport ? SPORTS[mapSport].defaultOverlays.filter((id) => AVAILABLE_OVERLAY_IDS.has(id)) : []),
    [mapSport],
  );
  const [localOverlays, setLocalOverlays] = useState<Partial<Record<MapOverlayId, boolean>>>({});
  useEffect(() => {
    const out: Partial<Record<MapOverlayId, boolean>> = {};
    // Carta pulita di default: solo le piste per gli sport invernali; il resto si accende dai Livelli.
    for (const id of recommended) out[id] = id === "opensnow";
    setLocalOverlays(out);
  }, [recommended]);
  const sportOverlays = sportOverlaysProp ?? localOverlays;
  const toggleOverlay = useCallback(
    (id: MapOverlayId) => {
      const next = { ...sportOverlays, [id]: !sportOverlays[id] };
      setLocalOverlays(next);
      onSportOverlaysChange?.(next);
    },
    [onSportOverlaysChange, sportOverlays],
  );

  const optsRef = useRef({ slopeVisible, slopeOpacity, avalancheVisible, avalancheOpacity, sportOverlays, prefs, baseStyle, mapSport, mapMode });
  useEffect(() => {
    optsRef.current = { slopeVisible, slopeOpacity, avalancheVisible, avalancheOpacity, sportOverlays, prefs, baseStyle, mapSport, mapMode };
  });

  const handlerRefs = useMemo(
    () => ({
      onInteractionRef,
      onWaypointMoveRef,
      onRouteDragStartRef,
      poisRef,
      waypointsRef,
      dragRef,
      suppressClickRef,
      onRouteSelectRef,
      onReportSelectRef,
      outdoorFeaturesRef,
      allowOutdoorPickRef,
      allowLabelPickRef,
    }),
    [],
  );

  /** Installa rilievo, curve, overlay e layer dati sullo stile corrente. */
  const installAll = useCallback(
    (map: MaplibreMap) => {
      const o = optsRef.current;
      const def = baseMapDef(o.baseStyle);
      const dark = isBaseDark(o.baseStyle, o.mapMode);
      const winter = isWinterTopo(o.mapSport);
      applyRelief(map, {
        hillshade: !def.ownRelief && o.prefs.hillshade,
        tint: !def.ownRelief && o.prefs.tint,
        dark,
        winter,
      });
      try {
        ensureContourLayers(map, dark);
        setContourLayerVisible(map, o.prefs.contours);
      } catch (e) {
        console.warn("[map] curve di livello non disponibili", e);
      }
      addOverlaySourcesAndLayers(map, {
        slopeVisible: o.slopeVisible || !!o.sportOverlays.slope,
        slopeOpacity: o.slopeOpacity,
        avalancheVisible: o.avalancheVisible,
        avalancheOpacity: o.avalancheOpacity,
        sportOverlays: o.sportOverlays,
      });
      layerHandlerCleanupRef.current?.();
      layerHandlerCleanupRef.current = bindLayerHandlers(map, handlerRefs);
      if (!globalHandlersAttachedRef.current) {
        globalHandlersAttachedRef.current = true;
        attachGlobalHandlers(map, handlerRefs);
      }
      applyTerrain3d(map, view3dRef.current, false, dark);
      layersReadyRef.current = true;
      setStyleEpoch((n) => n + 1);
    },
    [handlerRefs],
  );

  /* ── Creazione mappa (una sola volta, dopo aver letto le preferenze) ── */
  useEffect(() => {
    if (!prefsLoaded || !containerRef.current || mapRef.current) return;
    const base = optsRef.current.baseStyle;
    appliedBaseRef.current = `${base}:${baseMapDef(base).supportsDark ? optsRef.current.mapMode : "fixed"}`;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleForBaseId(base, optsRef.current.mapSport, optsRef.current.mapMode),
      center: [
        initialCenter?.lng ?? DEFAULT_MAP_VIEW_CENTER.lng,
        initialCenter?.lat ?? DEFAULT_MAP_VIEW_CENTER.lat,
      ],
      zoom: initialCenter?.zoom ?? DEFAULT_MAP_VIEW_CENTER.zoom,
      pitch: terrain3d ? 55 : 0,
      maxPitch: 80,
      attributionControl: { compact: true },
      fadeDuration: 150,
    });
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-right");
    map.touchZoomRotate.enableRotation();
    attachMapImages(map);

    let fellBack = false;
    map.on("error", (e) => {
      const msg = String((e as { error?: Error }).error?.message ?? "");
      if (!fellBack && !map.isStyleLoaded() && /style|Failed to fetch|NetworkError/i.test(msg)) {
        fellBack = true;
        map.setStyle(OSM_RASTER_STYLE);
      }
    });
    map.on("style.load", () => {
      layersReadyRef.current = false;
      installAll(map);
      setMapReady(true);
      onViewportChangeRef.current?.(bboxOf(map), { zoom: map.getZoom() });
    });
    map.on("moveend", () => {
      onViewportChangeRef.current?.(bboxOf(map), { zoom: map.getZoom() });
    });
    map.on("rotate", () => setBearing(map.getBearing()));
    map.on("dataloading", () => setTilesLoading(true));
    map.on("idle", () => setTilesLoading(false));
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __v2map?: MaplibreMap }).__v2map = map;
    return () => {
      layerHandlerCleanupRef.current?.();
      layerHandlerCleanupRef.current = null;
      layersReadyRef.current = false;
      globalHandlersAttachedRef.current = false;
      if (watchIdRef.current != null) navigator.geolocation?.clearWatch(watchIdRef.current);
      userMarkerRef.current?.remove();
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- creata una sola volta; i cambi passano da effetti dedicati
  }, [prefsLoaded, installAll]);

  /* ── Cambio centro iniziale (es. percorso caricato): sposta senza ricreare ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !initialCenter) return;
    map.jumpTo({ center: [initialCenter.lng, initialCenter.lat], zoom: initialCenter.zoom ?? map.getZoom() });
  }, [initialCenter?.lat, initialCenter?.lng, initialCenter?.zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Padding camera (pannelli che coprono la mappa) ── */
  const padTop = viewPadding?.top ?? 0;
  const padBottom = viewPadding?.bottom ?? 0;
  const padLeft = viewPadding?.left ?? 0;
  const padRight = viewPadding?.right ?? 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.easeTo({ padding: { top: padTop, bottom: padBottom, left: padLeft, right: padRight }, duration: 300 });
  }, [mapReady, padTop, padBottom, padLeft, padRight]);

  /* ── Cambio basemap ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || appliedBaseRef.current === styleKey) return;
    appliedBaseRef.current = styleKey;
    layersReadyRef.current = false;
    map.setStyle(styleForBaseId(baseStyle, mapSport, mapMode), { diff: false });
  }, [baseStyle, styleKey, mapMode, mapReady, mapSport]);

  /* ── Rilievo / curve ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;
    applyRelief(map, {
      hillshade: !baseDef.ownRelief && prefs.hillshade,
      tint: !baseDef.ownRelief && prefs.tint,
      dark: baseDark,
      winter: isWinterTopo(mapSport),
    });
    setContourLayerVisible(map, prefs.contours);
  }, [mapReady, styleEpoch, prefs.hillshade, prefs.tint, prefs.contours, baseDef.ownRelief, baseDark, mapSport]);

  /* ── Heatmap (personale / community): ricarica i punti a ogni spostamento ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;
    ensureHeatLayers(map);
    const enabled: Record<HeatScope, boolean> = { me: prefs.heatMe, community: prefs.heatCommunity };
    setHeatVisible(map, "me", enabled.me);
    setHeatVisible(map, "community", enabled.community);
    if (!enabled.me && !enabled.community) return;
    const sports = mapSport ? heatSportFamily(mapSport).join(",") : "";
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(",");
      const z = Math.round(map.getZoom());
      for (const scope of ["me", "community"] as const) {
        if (!enabled[scope]) continue;
        const qs = new URLSearchParams({ scope, bbox, z: String(z) });
        if (sports) qs.set("sport", sports);
        fetch(`/api/v2/heatmap?${qs}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((fc: GeoJSON.FeatureCollection | null) => {
            if (fc && map.getSource(HEAT_SOURCE[scope])) setGeoJsonData(map, HEAT_SOURCE[scope], fc);
          })
          .catch(() => undefined);
      }
    };
    const onMove = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 250);
    };
    load();
    map.on("moveend", onMove);
    return () => {
      map.off("moveend", onMove);
      if (timer) clearTimeout(timer);
      ctrl?.abort();
    };
  }, [mapReady, styleEpoch, prefs.heatMe, prefs.heatCommunity, mapSport]);

  /* ── Tratti mai percorsi dalla community ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;
    ensureHeatLayers(map);
    setGeoJsonData(map, UNTRODDEN_SOURCE, untroddenGeoJson ?? { type: "FeatureCollection", features: [] });
  }, [mapReady, styleEpoch, untroddenGeoJson]);

  /* ── Dati (percorso, tappe, POI, …) ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;

    const routeGeo: GeoJSON.FeatureCollection = (() => {
      if (exploreGeoJson && exploreGeoJson.features.length > 0) return exploreGeoJson;
      if (routeColoredSegments && routeColoredSegments.length > 0) {
        return {
          type: "FeatureCollection",
          features: routeColoredSegments.map((seg, i) => ({
            type: "Feature" as const,
            properties: { color: seg.color, surface: seg.surface, idx: i },
            geometry: { type: "LineString" as const, coordinates: seg.coordinates },
          })),
        };
      }
      if (routeCoords && routeCoords.length >= 2) {
        return {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeCoords } }],
        };
      }
      return EMPTY_FC;
    })();

    const n = waypoints.length;
    const wpGeo: GeoJSON.FeatureCollection = showWaypoints
      ? {
          type: "FeatureCollection",
          features: waypoints.map((w, i) => ({
            type: "Feature",
            properties: {
              idx: i + 1,
              label: w.label ?? String(i + 1),
              role: n === 1 ? "single" : i === 0 ? "start" : i === n - 1 ? "end" : "via",
            },
            geometry: { type: "Point", coordinates: [w.lng, w.lat] },
          })),
        }
      : EMPTY_FC;

    const poiGeo: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: pois.map((p) => {
        const kindMeta = resolvePoiKind(p.category as PoiCategory, p.sub_kind);
        return {
          type: "Feature",
          properties: {
            id: p.id,
            name: p.name ?? kindMeta.label,
            category: p.category,
            kind: kindMeta.label,
            color: kindMeta.color,
          },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        };
      }),
    };

    const pendingGeo: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: pendingPoint
        ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [pendingPoint.lng, pendingPoint.lat] } }]
        : [],
    };

    let radiusGeo: GeoJSON.FeatureCollection = EMPTY_FC;
    if (poiSearchBbox) {
      const { south, west, north, east } = poiSearchBbox;
      radiusGeo = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
            },
          },
        ],
      };
    } else if (poiSearchCenter) {
      radiusGeo = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [circlePolygon(poiSearchCenter.lng, poiSearchCenter.lat, 3000, 64)] },
          },
        ],
      };
    }

    const previewGeo: GeoJSON.FeatureCollection =
      showWaypoints && routeGeo.features.length === 0 && waypoints.length >= 2
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: waypoints.map((w) => [w.lng, w.lat]) },
              },
            ],
          }
        : EMPTY_FC;

    setGeoJson(map, "v2-route", routeGeo);
    setGeoJson(map, "v2-route-preview", previewGeo);
    setGeoJson(map, "v2-route-markers", routeMarkersGeoJson ?? EMPTY_FC);
    setGeoJson(map, "v2-waypoints", wpGeo);
    setGeoJson(map, "v2-pois", poiGeo);
    setGeoJson(map, "v2-pending", pendingGeo);
    setGeoJson(map, "v2-poi-radius", radiusGeo);
    setGeoJson(map, "v2-photos", photosGeoJson ?? EMPTY_FC);
    setGeoJson(map, "v2-outing-stops", outingStopsGeoJson ?? EMPTY_FC);
    setGeoJson(map, "v2-reports", reportsGeoJson ?? EMPTY_FC);
    setGeoJson(map, "v2-outdoor", featuresGeoJson ?? EMPTY_FC);
  }, [
    routeCoords,
    routeColoredSegments,
    exploreGeoJson,
    routeMarkersGeoJson,
    photosGeoJson,
    outingStopsGeoJson,
    reportsGeoJson,
    featuresGeoJson,
    waypoints,
    showWaypoints,
    pois,
    pendingPoint,
    poiSearchCenter,
    poiSearchBbox,
    mapReady,
    styleEpoch,
  ]);

  /* ── Marker hover (profilo altimetrico ↔ mappa) ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;
    setGeoJson(
      map,
      "v2-hover",
      hoverPoint
        ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [hoverPoint.lng, hoverPoint.lat] } }] }
        : EMPTY_FC,
    );
  }, [hoverPoint?.lng, hoverPoint?.lat, mapReady, styleEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Pendenza / valanghe ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;
    const slopeOn = slopeVisible || !!sportOverlays.slope;
    if (map.getLayer("ski-slope")) {
      map.setLayoutProperty("ski-slope", "visibility", slopeOn ? "visible" : "none");
      map.setPaintProperty("ski-slope", "raster-opacity", slopeOpacity);
    }
    for (const layerId of ["ski-avalanche-fill", "ski-avalanche-line"]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", avalancheVisible ? "visible" : "none");
    }
    if (map.getLayer("ski-avalanche-fill")) map.setPaintProperty("ski-avalanche-fill", "fill-opacity", avalancheOpacity);
    if (map.getLayer("ski-avalanche-line")) {
      map.setPaintProperty("ski-avalanche-line", "line-opacity", avalancheVisible ? avalancheOpacity * 0.5 : 0);
    }
  }, [mapReady, slopeVisible, slopeOpacity, avalancheVisible, avalancheOpacity, styleEpoch, sportOverlays.slope]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;
    if (avalancheGeoJson) setGeoJson(map, "ski-avalanche", avalancheGeoJson);
  }, [avalancheGeoJson, mapReady, styleEpoch]);

  /* ── Camera ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !poiSearchCenter || poiSearchBbox || pois.length === 0) return;
    map.flyTo({ center: [poiSearchCenter.lng, poiSearchCenter.lat], zoom: Math.max(map.getZoom(), 13), duration: 800 });
  }, [poiSearchCenter, poiSearchBbox, pois.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: flyTo.zoom ?? Math.max(map.getZoom(), 13),
      duration: 900,
    });
  }, [flyTo?.lng, flyTo?.lat, flyTo?.zoom, flyTo?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitTo || !mapReady) return;
    const [w, s, e, n] = fitTo.bbox;
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: fitTo.padding ?? 60, duration: 900, maxZoom: 15 },
    );
  }, [fitTo?.key, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    applyTerrain3d(map, view3d, true, baseDark);
  }, [view3d, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sovrapposizioni raster + radar ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;
    setSportOverlayVisibility(map, sportOverlays);
    let cancelled = false;
    void (async () => {
      const layerId = "overlay-rainviewer-layer";
      if (!sportOverlays.rainviewer) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", "none");
        return;
      }
      const path = await rainViewerTilePath();
      if (!path || cancelled || !map.isStyleLoaded()) return;
      const sourceId = "overlay-rainviewer";
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: "raster", tiles: [rainViewerTilesUrl(path)], tileSize: 256, attribution: "© RainViewer" });
        map.addLayer({ id: layerId, type: "raster", source: sourceId, paint: { "raster-opacity": 0.6 } }, "v2-poi-radius");
      }
      map.setLayoutProperty(layerId, "visibility", "visible");
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, sportOverlays, styleEpoch]);

  /* ── Geolocalizzazione ── */
  const updateUserPosition = useCallback((lng: number, lat: number, acc: number) => {
    const map = mapRef.current;
    if (!map) return;
    userPosRef.current = { lng, lat, acc };
    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "v2-user-dot";
      el.setAttribute("aria-label", "La tua posizione");
      userMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    } else {
      userMarkerRef.current.setLngLat([lng, lat]);
    }
    if (map.getSource("v2-user-acc")) {
      setGeoJson(map, "v2-user-acc", {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [circlePolygon(lng, lat, Math.max(5, Math.min(acc, 2000)), 48)] },
          },
        ],
      });
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const p = userPosRef.current;
    if (map && p && mapReady && layersReadyRef.current) updateUserPosition(p.lng, p.lat, p.acc);
  }, [styleEpoch, mapReady, updateUserPosition]);

  const locate = useCallback(() => {
    const map = mapRef.current;
    if (!map || !("geolocation" in navigator)) {
      setGeo("error");
      return;
    }
    const known = userPosRef.current;
    if (geo === "on" && known) {
      map.flyTo({ center: [known.lng, known.lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });
      return;
    }
    setGeo("locating");
    let first = true;
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude, latitude, accuracy } = pos.coords;
        updateUserPosition(longitude, latitude, accuracy);
        setGeo("on");
        if (first) {
          first = false;
          map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14), duration: 900 });
        }
      },
      () => setGeo("error"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, [geo, updateUserPosition]);

  const resetNorth = () => mapRef.current?.easeTo({ bearing: 0, duration: 500 });

  return (
    <div
      className="v2-map relative h-full w-full min-h-0 overflow-hidden bg-[color:var(--hmr-bg)]"
      style={{ ["--v2-pad-b" as string]: `${padBottom}px`, ["--v2-pad-l" as string]: `${padLeft}px` }}
    >
      <div ref={containerRef} className="h-full w-full min-h-0" />
      {busy || tilesLoading ? <div className="v2-progress" aria-hidden /> : null}

      {/* Controlli mappa */}
      <div
        className="pointer-events-none absolute right-2.5 z-30 flex flex-col items-end gap-2 sm:right-3"
        style={{ top: `calc(${controlsTopOffset}px + 0.75rem)` }}
      >
        <div className="ui-glass pointer-events-auto flex flex-col rounded-lg p-1">
          <button
            type="button"
            className="ui-icon-btn"
            onClick={() => setLayersOpen((v) => !v)}
            aria-pressed={layersOpen}
            aria-label="Livelli mappa"
            title="Livelli mappa"
          >
            <Icon name="layers" />
          </button>
          <button
            type="button"
            className="ui-icon-btn text-[12px] font-extrabold tracking-tight"
            onClick={() => setView3d((v) => !v)}
            aria-pressed={view3d}
            aria-label="Terreno 3D"
            title="Terreno 3D"
          >
            3D
          </button>
          <button
            type="button"
            className={`ui-icon-btn ${geo === "on" ? "!text-[color:var(--hmr-accent-2)]" : geo === "error" ? "!text-[color:var(--hmr-danger)]" : ""}`}
            onClick={locate}
            aria-label="La mia posizione"
            title={geo === "error" ? "Posizione non disponibile" : "La mia posizione"}
          >
            <Icon name={geo === "on" ? "locateFixed" : "locate"} className={geo === "locating" ? "animate-pulse" : ""} />
          </button>
        </div>
        <div className="ui-glass pointer-events-auto hidden flex-col rounded-lg p-1 sm:flex">
          <button type="button" className="ui-icon-btn" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom avanti">
            <Icon name="plus" />
          </button>
          <button type="button" className="ui-icon-btn" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom indietro">
            <Icon name="minus" />
          </button>
        </div>
        {Math.abs(bearing) > 0.5 ? (
          <button
            type="button"
            className="ui-glass pointer-events-auto grid h-10 w-10 place-items-center rounded-full text-[color:var(--hmr-danger)]"
            onClick={resetNorth}
            aria-label="Orienta a nord"
            title="Orienta a nord"
          >
            <Icon name="north" size={22} style={{ transform: `rotate(${-bearing}deg)` }} />
          </button>
        ) : null}
      </div>

      <MapLayersPanel
        open={layersOpen}
        onClose={() => setLayersOpen(false)}
        base={baseStyle}
        onBaseChange={(id) => updatePrefs({ base: id })}
        prefs={prefs}
        onPrefsChange={updatePrefs}
        view3d={view3d}
        onView3dChange={setView3d}
        overlays={sportOverlays}
        onToggleOverlay={toggleOverlay}
        recommended={recommended}
        sportLabel={mapSport ? SPORTS[mapSport].shortLabel : undefined}
        baseHasOwnRelief={baseDef.ownRelief}
        mapMode={prefs.mapMode}
        onMapModeChange={(m) => updatePrefs({ mapMode: m })}
        appTheme={appTheme}
        onAppThemeChange={setAppTheme}
        baseSupportsDark={baseDef.supportsDark}
      />
    </div>
  );
}
