"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MaplibreMap, StyleSpecification, MapGeoJSONFeature, MapMouseEvent } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  CheckpointRow,
  CourseBridgeRow,
  NotableSectionRow,
  PoiCategory,
  PoiRow,
  RacePlanItemRow,
  ResupplyRow,
} from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import { CATEGORY_META } from "@/lib/categories";
import type { TrackSurfaceKind } from "@/lib/surface-osm";
import type { StreetViewAlongItem } from "@/lib/along-media-types";
import { coordAtKm, polylineBetween, projectLngLatToTrack } from "@/lib/track-measure";

export type MapViewProps = {
  coords: StoredCoord[];
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  checkpoints: CheckpointRow[];
  resupply: ResupplyRow[];
  sections: NotableSectionRow[];
  bridges: CourseBridgeRow[];
  pois: PoiRow[];
  visibleCategories: Set<PoiCategory>;
  showResupply: boolean;
  showSections: boolean;
  myAlongKm: number | null;
  myPosition: { lat: number; lng: number } | null;
  hoverKm: number | null;
  pinAKm: number | null;
  pinBKm: number | null;
  onHoverKm?: (km: number | null) => void;
  onPin?: (km: number) => void;
  onSelectPoi?: (poi: PoiRow) => void;
  /** Annotazioni piano gara (solo layer; click gestito da trackClickMode). */
  racePlanItems?: RacePlanItemRow[];
  trackClickMode?: "measure" | "racePlan" | "poiHarvest" | "addPoi";
  onTrackKmPick?: (km: number) => void;
  /** Modalità “cerca POI OSM”: clic ovunque sulla mappa (non solo sulla traccia). */
  onPoiHarvestClick?: (lat: number, lng: number) => void;
  /** Aggiungi POI: clic sulla mappa → coordinate WGS84. */
  onAddPoiMapClick?: (lat: number, lng: number) => void;
  /** Segmenti km con superficie (solo profilo altimetrico; la mappa usa la traccia unica). */
  surfaceSegments?: Array<{ km_start: number; km_end: number; surface: TrackSurfaceKind }>;
  /** Street View lungo traccia (API server). */
  streetViewPoints?: StreetViewAlongItem[];
  showStreetViewLayer?: boolean;
  /** Zoom mappa su un tratto km (es. tappa piano gara); il parent può azzerare dopo ~1s. */
  flyToKmRange?: { lo: number; hi: number } | null;
  /** Centro e zoom attuali (es. per aprire Windy sulla stessa vista). */
  onViewportChange?: (v: { lat: number; lng: number; zoom: number }) => void;
};

const HOVER_SNAP_PX = 20;
const PIN_SNAP_PX = 24;
const INTERACTIVE_LAYERS = [
  "pois-circle",
  "checkpoints-core",
  "checkpoints-halo",
  "sections-line",
  "sections-danger-circle",
  "bridges-circle",
  "resupply-circle",
  "streetview-circle",
];

const OSM_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap",
      maxzoom: 19,
    },
    terrain: {
      type: "raster",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenTopoMap (CC-BY-SA)",
      maxzoom: 17,
    },
  },
  layers: [
    { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 1 } },
    {
      id: "terrain",
      type: "raster",
      source: "terrain",
      paint: { "raster-opacity": 0.35 },
    },
  ],
};

function lngLatOnTrack(
  coords: StoredCoord[],
  alongKm: number,
  fallbackLng: number,
  fallbackLat: number
): [number, number] {
  const onTrack = coordAtKm(coords, alongKm);
  return onTrack ? [onTrack.lng, onTrack.lat] : [fallbackLng, fallbackLat];
}

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const readyRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const coordsArray = useMemo<[number, number][]>(
    () => props.coords.map((c) => [c[0], c[1]]),
    [props.coords]
  );

  const coordsRef = useRef(props.coords);
  const onHoverKmRef = useRef(props.onHoverKm);
  const onPinRef = useRef(props.onPin);
  const trackClickModeRef = useRef(props.trackClickMode ?? "measure");
  const onTrackKmPickRef = useRef(props.onTrackKmPick);
  const onPoiHarvestClickRef = useRef(props.onPoiHarvestClick);
  const onAddPoiMapClickRef = useRef(props.onAddPoiMapClick);
  const onViewportChangeRef = useRef(props.onViewportChange);
  const lastHoverEmitRef = useRef<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  useEffect(() => {
    coordsRef.current = props.coords;
  }, [props.coords]);
  useEffect(() => {
    onHoverKmRef.current = props.onHoverKm;
  }, [props.onHoverKm]);
  useEffect(() => {
    onPinRef.current = props.onPin;
  }, [props.onPin]);
  useEffect(() => {
    trackClickModeRef.current = props.trackClickMode ?? "measure";
  }, [props.trackClickMode]);
  useEffect(() => {
    onTrackKmPickRef.current = props.onTrackKmPick;
  }, [props.onTrackKmPick]);
  useEffect(() => {
    onPoiHarvestClickRef.current = props.onPoiHarvestClick;
  }, [props.onPoiHarvestClick]);
  useEffect(() => {
    onAddPoiMapClickRef.current = props.onAddPoiMapClick;
  }, [props.onAddPoiMapClick]);
  useEffect(() => {
    onViewportChangeRef.current = props.onViewportChange;
  }, [props.onViewportChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      map.getCanvas().style.cursor =
        props.trackClickMode === "poiHarvest" || props.trackClickMode === "addPoi"
          ? "crosshair"
          : "";
    } catch {
      /* canvas non pronto */
    }
  }, [props.trackClickMode]);

  /** Punti esatti ogni 10 km lungo la polyline (0, 10, 20, … fino all’ultimo multiplo ≤ fine gara). */
  const kmMarkers = useMemo(() => {
    if (props.coords.length === 0) return [];
    const totalKm = props.coords[props.coords.length - 1][3];
    const maxLabel = Math.floor(totalKm / 10) * 10;
    const out: Array<{ km: number; lng: number; lat: number }> = [];
    for (let km = 0; km <= maxLabel; km += 10) {
      const c = coordAtKm(props.coords, km);
      if (c) out.push({ km, lng: c.lng, lat: c.lat });
    }
    return out;
  }, [props.coords]);

  const racePlanGeo = useMemo(() => {
    const items = props.racePlanItems ?? [];
    const lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const ptFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const it of items) {
      const isPoint = Math.abs(it.km_end - it.km_start) < 0.05;
      if (isPoint) {
        const c = coordAtKm(props.coords, it.km_start);
        if (c) {
          ptFeatures.push({
            type: "Feature",
            properties: {
              id: it.id,
              kind: it.kind,
              title: it.title ?? "",
            },
            geometry: { type: "Point", coordinates: [c.lng, c.lat] },
          });
        }
      } else {
        const poly = polylineBetween(props.coords, it.km_start, it.km_end);
        if (poly.length >= 2) {
          lineFeatures.push({
            type: "Feature",
            properties: {
              id: it.id,
              kind: it.kind,
              title: it.title ?? "",
              avoid_night: it.avoid_night,
            },
            geometry: { type: "LineString", coordinates: poly },
          });
        }
      }
    }
    return { lineFeatures, ptFeatures };
  }, [props.racePlanItems, props.coords]);

  const sectionFeatures = useMemo(() => {
    const out: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    for (const s of props.sections) {
      const coords: [number, number][] = [];
      for (const c of props.coords) {
        if (c[3] >= s.km_start && c[3] <= s.km_end) coords.push([c[0], c[1]]);
      }
      if (coords.length >= 2) {
        out.push({
          type: "Feature",
          properties: { id: s.id, label: s.label, severity: s.severity, description: s.description },
          geometry: { type: "LineString", coordinates: coords },
        });
      }
    }
    return out;
  }, [props.sections, props.coords]);

  const sectionPointFeatures = useMemo(() => {
    const out: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const s of props.sections) {
      const midKm = (s.km_start + s.km_end) / 2;
      const c = coordAtKm(props.coords, midKm);
      if (c) {
        out.push({
          type: "Feature",
          properties: {
            id: s.id,
            label: s.label,
            severity: s.severity,
            description_en: (s as NotableSectionRow).description_en ?? s.description,
          },
          geometry: { type: "Point", coordinates: [c.lng, c.lat] },
        });
      }
    }
    return out;
  }, [props.sections, props.coords]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [
        (props.bbox.minLng + props.bbox.maxLng) / 2,
        (props.bbox.minLat + props.bbox.maxLat) / 2,
      ],
      zoom: 7,
      attributionControl: false,
    });
    mapRef.current = map;

    const emitViewport = () => {
      const cb = onViewportChangeRef.current;
      if (!cb) return;
      try {
        const c = map.getCenter();
        cb({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
      } catch {
        /* mappa non pronta */
      }
    };
    map.on("moveend", emitViewport);

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showAccuracyCircle: false,
      }),
      "top-right"
    );

    let didFit = false;
    const tryFit = () => {
      if (didFit) return;
      const el = containerRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      map.resize();
      map.fitBounds(
        [
          [props.bbox.minLng, props.bbox.minLat],
          [props.bbox.maxLng, props.bbox.maxLat],
        ],
        { padding: 40, duration: 0 }
      );
      didFit = true;
    };
    const pollStart = Date.now();
    const pollId = window.setInterval(() => {
      tryFit();
      if (didFit || Date.now() - pollStart > 5000) {
        window.clearInterval(pollId);
      }
    }, 150);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            map.resize();
            tryFit();
          })
        : null;
    if (resizeObserver && containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    map.on("load", () => {
      readyRef.current = true;
      tryFit();
      map.getCanvas().style.cursor =
        trackClickModeRef.current === "poiHarvest" ||
        trackClickModeRef.current === "addPoi"
          ? "crosshair"
          : "";
      map.addSource("track", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coordsArray },
        },
      });
      map.addLayer({
        id: "track-shadow",
        type: "line",
        source: "track",
        paint: {
          "line-color": "#000",
          "line-opacity": 0.35,
          "line-width": 6,
        },
        layout: { "line-cap": "butt", "line-join": "miter" },
      });
      map.addLayer({
        id: "track-main",
        type: "line",
        source: "track",
        paint: {
          "line-color": "#38bdf8",
          "line-width": 3,
        },
        layout: { "line-cap": "butt", "line-join": "miter" },
      });
      map.addSource("sections", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "sections-line",
        type: "line",
        source: "sections",
        paint: {
          "line-width": 7,
          "line-color": [
            "match",
            ["get", "severity"],
            "hard",
            "#f87171",
            "warn",
            "#fbbf24",
            "#38bdf8",
          ],
          "line-opacity": 0.85,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addSource("sections-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "sections-danger-circle",
        type: "circle",
        source: "sections-points",
        paint: {
          "circle-radius": 11,
          "circle-color": [
            "match",
            ["get", "severity"],
            "hard", "#f87171",
            "warn", "#fbbf24",
            "#38bdf8",
          ],
          "circle-stroke-color": "#0b1221",
          "circle-stroke-width": 1.8,
          "circle-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "sections-danger-label",
        type: "symbol",
        source: "sections-points",
        layout: {
          "text-field": "!",
          "text-size": 14,
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Regular"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-offset": [0, 0.05],
        },
        paint: {
          "text-color": "#0b1221",
          "text-halo-color": "#ffffff",
          "text-halo-width": 0.5,
        },
      });
      map.addSource("bridges", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "bridges-circle",
        type: "circle",
        source: "bridges",
        paint: {
          "circle-radius": 10,
          "circle-color": "#22d3ee",
          "circle-stroke-color": "#0b1221",
          "circle-stroke-width": 1.8,
          "circle-opacity": 0.95,
        },
      });
      map.addSource("kmMarkers", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "kmMarkers-circle",
        type: "circle",
        source: "kmMarkers",
        paint: {
          "circle-radius": 8,
          "circle-color": "#0f172a",
          "circle-stroke-color": "#e2e8f0",
          "circle-stroke-width": 1.4,
        },
      });
      map.addLayer({
        id: "kmMarkers-label",
        type: "symbol",
        source: "kmMarkers",
        layout: {
          "text-field": ["concat", ["to-string", ["get", "km"]], " km"],
          "text-size": 11,
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Regular"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#f8fafc",
          "text-halo-color": "#0f172a",
          "text-halo-width": 1.2,
        },
      });
      map.addSource("pois", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "pois-circle",
        type: "circle",
        source: "pois",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            3,
            12,
            6,
            15,
            8,
          ],
          "circle-color": [
            "match",
            ["get", "category"],
            "water",
            CATEGORY_META.water.color,
            "hut",
            CATEGORY_META.hut.color,
            "lodging",
            CATEGORY_META.lodging.color,
            "campsite",
            CATEGORY_META.campsite.color,
            "shop",
            CATEGORY_META.shop.color,
            "restaurant",
            CATEGORY_META.restaurant.color,
            "pharmacy",
            CATEGORY_META.pharmacy.color,
            "atm",
            CATEGORY_META.atm.color,
            "bus",
            CATEGORY_META.bus.color,
            "#94a3b8",
          ],
          "circle-stroke-color": "#0b1221",
          "circle-stroke-width": 1.3,
          "circle-opacity": 0.95,
        },
      });
      map.addSource("resupply", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "resupply-circle",
        type: "circle",
        source: "resupply",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            5,
            12,
            9,
          ],
          "circle-color": "#fde68a",
          "circle-stroke-color": "#b45309",
          "circle-stroke-width": 1.6,
        },
      });
      map.addLayer({
        id: "resupply-label",
        type: "symbol",
        source: "resupply",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#fde68a",
          "text-halo-color": "#0b1221",
          "text-halo-width": 1.3,
        },
      });
      map.addSource("checkpoints", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "checkpoints-halo",
        type: "circle",
        source: "checkpoints",
        paint: {
          "circle-radius": 16,
          "circle-color": "#f87171",
          "circle-opacity": 0.18,
        },
      });
      map.addLayer({
        id: "checkpoints-core",
        type: "circle",
        source: "checkpoints",
        paint: {
          "circle-radius": 9,
          "circle-color": "#f87171",
          "circle-stroke-color": "#0b1221",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "checkpoints-label",
        type: "symbol",
        source: "checkpoints",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 12,
          "text-offset": [0, 1.3],
          "text-anchor": "top",
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": "#fca5a5",
          "text-halo-color": "#0b1221",
          "text-halo-width": 1.4,
        },
      });
      map.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "me-halo",
        type: "circle",
        source: "me",
        paint: {
          "circle-radius": 18,
          "circle-color": "#38bdf8",
          "circle-opacity": 0.22,
        },
      });
      map.addLayer({
        id: "me-core",
        type: "circle",
        source: "me",
        paint: {
          "circle-radius": 7,
          "circle-color": "#38bdf8",
          "circle-stroke-color": "#0b1221",
          "circle-stroke-width": 2,
        },
      });
      map.addSource("projected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "projected-core",
        type: "circle",
        source: "projected",
        paint: {
          "circle-radius": 5,
          "circle-color": "#4ade80",
          "circle-stroke-color": "#0b1221",
          "circle-stroke-width": 1.5,
        },
      });
      map.addSource("measure-segment", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer(
        {
          id: "measure-segment-line",
          type: "line",
          source: "measure-segment",
          paint: {
            "line-color": "#facc15",
            "line-width": 6,
            "line-opacity": 0.85,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        },
        "track-main"
      );
      map.addSource("hover-point", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "hover-point-halo",
        type: "circle",
        source: "hover-point",
        paint: {
          "circle-radius": 10,
          "circle-color": "#f6f8ff",
          "circle-opacity": 0.25,
        },
      });
      map.addLayer({
        id: "hover-point-core",
        type: "circle",
        source: "hover-point",
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#f6f8ff",
          "circle-stroke-color": "#0b1221",
          "circle-stroke-width": 1.2,
        },
      });
      map.addSource("pins", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "pins-halo",
        type: "circle",
        source: "pins",
        paint: {
          "circle-radius": 14,
          "circle-color": [
            "match",
            ["get", "which"],
            "A",
            "#4ade80",
            "B",
            "#f59e0b",
            "#38bdf8",
          ],
          "circle-opacity": 0.22,
        },
      });
      map.addLayer({
        id: "pins-core",
        type: "circle",
        source: "pins",
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "match",
            ["get", "which"],
            "A",
            "#4ade80",
            "B",
            "#f59e0b",
            "#38bdf8",
          ],
          "circle-stroke-color": "#0b1221",
          "circle-stroke-width": 1.8,
        },
      });
      map.addLayer({
        id: "pins-label",
        type: "symbol",
        source: "pins",
        layout: {
          "text-field": ["get", "which"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": true,
          "text-offset": [0, 0.05],
        },
        paint: {
          "text-color": "#0b1221",
          "text-halo-color": "#f6f8ff",
          "text-halo-width": 1.2,
        },
      });

      map.addSource("racePlanSegs", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer(
        {
          id: "race-plan-segments",
          type: "line",
          source: "racePlanSegs",
          paint: {
            "line-width": ["case", ["==", ["get", "kind"], "night_avoid"], 5, 3.5],
            "line-opacity": 0.88,
            "line-color": [
              "match",
              ["get", "kind"],
              "night_avoid",
              "#a855f7",
              "sleep",
              "#4ade80",
              "stage",
              "#38bdf8",
              "time",
              "#fbbf24",
              "note",
              "#94a3b8",
              "#64748b",
            ],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        },
        "pois-circle"
      );
      map.addSource("racePlanPts", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer(
        {
          id: "race-plan-points",
          type: "circle",
          source: "racePlanPts",
          paint: {
            "circle-radius": 7,
            "circle-color": [
              "match",
              ["get", "kind"],
              "night_avoid",
              "#a855f7",
              "sleep",
              "#4ade80",
              "stage",
              "#38bdf8",
              "time",
              "#fbbf24",
              "#94a3b8",
            ],
            "circle-stroke-color": "#0b1221",
            "circle-stroke-width": 1.6,
            "circle-opacity": 0.92,
          },
        },
        "pois-circle"
      );

      map.addSource("streetview", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer(
        {
          id: "streetview-circle",
          type: "circle",
          source: "streetview",
          paint: {
            "circle-radius": 9,
            "circle-color": "#c4b5fd",
            "circle-stroke-color": "#0b1221",
            "circle-stroke-width": 1.6,
            "circle-opacity": 0.95,
          },
        },
        "pois-circle"
      );
      map.addLayer(
        {
          id: "streetview-label",
          type: "symbol",
          source: "streetview",
          layout: {
            "text-field": ["get", "label_km"],
            "text-size": 10,
            "text-offset": [0, 1.15],
            "text-anchor": "top",
            "text-font": ["Noto Sans Regular"],
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#e9d5ff",
            "text-halo-color": "#0b1221",
            "text-halo-width": 1.2,
          },
        },
        "pois-circle"
      );

      // Marker km sopra tutto; checkpoint/resupply sopra POI e traccia
      try {
        map.moveLayer("checkpoints-halo");
        map.moveLayer("checkpoints-core");
        map.moveLayer("checkpoints-label");
        map.moveLayer("resupply-circle");
        map.moveLayer("resupply-label");
        map.moveLayer("kmMarkers-circle");
        map.moveLayer("kmMarkers-label");
      } catch {
        /* ignore */
      }

      setMapReady(true);

      map.on("click", "streetview-circle", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const lat = Number((f.properties as { lat?: string }).lat);
        const lng = Number((f.properties as { lng?: string }).lng);
        const along = (f.properties as { along_km?: string }).along_km ?? "";
        const mapsFromProp = (f.properties as { maps_url?: string }).maps_url ?? "";
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const mapsUrl =
          mapsFromProp.trim().length > 0
            ? mapsFromProp
            : `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}`;
        new maplibregl.Popup({ closeButton: true, offset: 10 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font: 12px/1.35 ui-sans-serif, system-ui; color:#0b1221; max-width: 220px">
              <div style="font-weight:600; margin-bottom:6px">Street View · km ${escapeHtml(String(along))}</div>
              <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="color:#4f46e5">Apri in Google Maps</a>
              <div style="margin-top:6px;font-size:10px;opacity:.65">© Google</div>
            </div>`
          )
          .addTo(map);
      });
      map.on("mouseenter", "streetview-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "streetview-circle", () => (map.getCanvas().style.cursor = ""));

      const emitHover = (km: number | null) => {
        if (km == null) {
          if (lastHoverEmitRef.current !== null) {
            lastHoverEmitRef.current = null;
            onHoverKmRef.current?.(null);
          }
          return;
        }
        const prev = lastHoverEmitRef.current;
        if (prev != null && Math.abs(prev - km) < 0.005) return;
        lastHoverEmitRef.current = km;
        onHoverKmRef.current?.(km);
      };

      const projectAtPointerPx = (e: MapMouseEvent) => {
        const proj = projectLngLatToTrack(coordsRef.current, e.lngLat.lng, e.lngLat.lat);
        if (!proj) return null;
        const p = map.project([proj.lng, proj.lat]);
        const dx = p.x - e.point.x;
        const dy = p.y - e.point.y;
        return { proj, pxDist: Math.sqrt(dx * dx + dy * dy) };
      };

      map.on("mousemove", (e) => {
        if (hoverRafRef.current != null) return;
        hoverRafRef.current = window.requestAnimationFrame(() => {
          hoverRafRef.current = null;
          const r = projectAtPointerPx(e);
          if (!r) {
            emitHover(null);
            return;
          }
          if (r.pxDist <= HOVER_SNAP_PX) {
            emitHover(r.proj.alongKm);
          } else {
            emitHover(null);
          }
        });
      });
      map.on("mouseout", () => emitHover(null));

      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: INTERACTIVE_LAYERS });
        if (hits && hits.length > 0) return;
        if (trackClickModeRef.current === "poiHarvest") {
          onPoiHarvestClickRef.current?.(e.lngLat.lat, e.lngLat.lng);
          return;
        }
        if (trackClickModeRef.current === "addPoi") {
          onAddPoiMapClickRef.current?.(e.lngLat.lat, e.lngLat.lng);
          return;
        }
        const r = projectAtPointerPx(e);
        if (!r) return;
        if (r.pxDist <= PIN_SNAP_PX) {
          if (trackClickModeRef.current === "racePlan") {
            onTrackKmPickRef.current?.(r.proj.alongKm);
          } else {
            onPinRef.current?.(r.proj.alongKm);
          }
        }
      });

      map.on("click", "pois-circle", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const id = (f.properties as { id?: string })?.id;
        if (!id || !props.onSelectPoi) return;
        const found = props.pois.find((p) => p.id === id);
        if (found) props.onSelectPoi(found);
      });
      map.on("click", "sections-line", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const label = (f.properties as { label?: string }).label ?? "";
        const description = (f.properties as { description?: string }).description ?? "";
        const severity = (f.properties as { severity?: string }).severity ?? "info";
        new maplibregl.Popup({ closeButton: true, offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font: 12px/1.3 ui-sans-serif, system-ui; color:#0b1221; max-width: 220px">
              <div style="font-weight:600; margin-bottom:4px">${escapeHtml(label)} <span style="opacity:.6">· ${severity}</span></div>
              <div>${escapeHtml(description)}</div>
            </div>`
          )
          .addTo(map);
      });
      map.on("click", "sections-danger-circle", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const label = (f.properties as { label?: string }).label ?? "";
        const descEn = (f.properties as { description_en?: string }).description_en ?? "";
        const severity = (f.properties as { severity?: string }).severity ?? "info";
        const badge =
          severity === "hard"
            ? `<span style="background:#f87171;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px">HARD</span>`
            : severity === "warn"
              ? `<span style="background:#fbbf24;color:#0b1221;padding:1px 6px;border-radius:4px;font-size:10px">WARN</span>`
              : "";
        new maplibregl.Popup({ closeButton: true, offset: 12 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font: 12px/1.4 ui-sans-serif, system-ui; color:#0b1221; max-width: 240px">
              <div style="font-weight:700; margin-bottom:5px">${escapeHtml(label)} ${badge}</div>
              <div>${escapeHtml(descEn)}</div>
            </div>`
          )
          .addTo(map);
      });
      map.on("mouseenter", "sections-danger-circle", () => (map.getCanvas().style.cursor = "help"));
      map.on("mouseleave", "sections-danger-circle", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "bridges-circle", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const name = (f.properties as { name?: string }).name ?? "";
        const desc = (f.properties as { description_en?: string }).description_en ?? "";
        new maplibregl.Popup({ closeButton: true, offset: 12 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font: 12px/1.4 ui-sans-serif, system-ui; color:#0b1221; max-width: 240px">
              <div style="font-weight:700; margin-bottom:5px">
                <span style="color:#0891b2">Bridge</span> · ${escapeHtml(name)}
              </div>
              <div>${escapeHtml(desc)}</div>
            </div>`
          )
          .addTo(map);
      });
      map.on("mouseenter", "bridges-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "bridges-circle", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "checkpoints-core", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const name = (f.properties as { name?: string }).name ?? "";
        const notes = (f.properties as { notes?: string }).notes ?? "";
        new maplibregl.Popup({ closeButton: true, offset: 10 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font: 12px/1.3 ui-sans-serif, system-ui; color:#0b1221; max-width: 220px">
              <div style="font-weight:600; margin-bottom:4px">${escapeHtml(name)}</div>
              <div>${escapeHtml(notes)}</div>
            </div>`
          )
          .addTo(map);
      });
      map.on("mouseenter", "pois-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "pois-circle", () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", "sections-line", () => (map.getCanvas().style.cursor = "help"));
      map.on("mouseleave", "sections-line", () => (map.getCanvas().style.cursor = ""));
    });

    return () => {
      map.off("moveend", emitViewport);
      window.clearInterval(pollId);
      resizeObserver?.disconnect();
      if (hoverRafRef.current != null) {
        window.cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
      setMapReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("track") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coordsArray },
    });
  }, [coordsArray, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("kmMarkers") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: kmMarkers.map((m) => ({
        type: "Feature",
        properties: { km: m.km },
        geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      })),
    });
  }, [kmMarkers, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("sections") as maplibregl.GeoJSONSource | undefined;
    src?.setData(
      props.showSections
        ? { type: "FeatureCollection", features: sectionFeatures }
        : { type: "FeatureCollection", features: [] }
    );
  }, [sectionFeatures, props.showSections, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("sections-points") as maplibregl.GeoJSONSource | undefined;
    src?.setData(
      props.showSections
        ? { type: "FeatureCollection", features: sectionPointFeatures }
        : { type: "FeatureCollection", features: [] }
    );
  }, [sectionPointFeatures, props.showSections, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("bridges") as maplibregl.GeoJSONSource | undefined;
    src?.setData(
      props.showSections
        ? {
            type: "FeatureCollection",
            features: props.bridges.map((b) => ({
              type: "Feature" as const,
              properties: {
                id: b.id,
                name: b.name,
                description_en: b.description_en,
              },
              geometry: { type: "Point" as const, coordinates: [b.lng, b.lat] },
            })),
          }
        : { type: "FeatureCollection", features: [] }
    );
  }, [props.bridges, props.showSections, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const features = props.pois
      .filter((p) => props.visibleCategories.has(p.category))
      .map((p) => ({
        type: "Feature" as const,
        properties: { id: p.id, category: p.category, name: p.name ?? "" },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      }));
    const src = map.getSource("pois") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });
  }, [props.pois, props.visibleCategories, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const segSrc = map.getSource("racePlanSegs") as maplibregl.GeoJSONSource | undefined;
    segSrc?.setData({ type: "FeatureCollection", features: racePlanGeo.lineFeatures });
    const ptSrc = map.getSource("racePlanPts") as maplibregl.GeoJSONSource | undefined;
    ptSrc?.setData({ type: "FeatureCollection", features: racePlanGeo.ptFeatures });
  }, [racePlanGeo, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("resupply") as maplibregl.GeoJSONSource | undefined;
    src?.setData(
      props.showResupply
        ? {
            type: "FeatureCollection",
            features: props.resupply.map((r) => {
              const [lng, lat] = lngLatOnTrack(props.coords, r.along_km, r.lng, r.lat);
              return {
                type: "Feature" as const,
                properties: { id: r.id, name: r.name, notes: r.notes, along_km: r.along_km },
                geometry: { type: "Point" as const, coordinates: [lng, lat] },
              };
            }),
          }
        : { type: "FeatureCollection", features: [] }
    );
  }, [props.resupply, props.showResupply, props.coords, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("checkpoints") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: props.checkpoints.map((c) => ({
        type: "Feature",
        properties: { id: c.id, name: c.name, notes: c.notes ?? "" },
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      })),
    });
  }, [props.checkpoints, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const meSrc = map.getSource("me") as maplibregl.GeoJSONSource | undefined;
    if (!meSrc) return;
    if (props.myPosition) {
      meSrc.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [props.myPosition.lng, props.myPosition.lat] },
          },
        ],
      });
    } else {
      meSrc.setData({ type: "FeatureCollection", features: [] });
    }
  }, [props.myPosition, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("projected") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (props.myAlongKm != null) {
      const coord = coordAtKm(props.coords, props.myAlongKm);
      if (coord) {
        src.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [coord.lng, coord.lat] },
            },
          ],
        });
        return;
      }
    }
    src.setData({ type: "FeatureCollection", features: [] });
  }, [props.myAlongKm, props.coords, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("hover-point") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (props.hoverKm != null) {
      const c = coordAtKm(props.coords, props.hoverKm);
      if (c) {
        src.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [c.lng, c.lat] },
            },
          ],
        });
        return;
      }
    }
    src.setData({ type: "FeatureCollection", features: [] });
  }, [props.hoverKm, props.coords, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("pins") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    if (props.pinAKm != null) {
      const c = coordAtKm(props.coords, props.pinAKm);
      if (c) {
        features.push({
          type: "Feature",
          properties: { which: "A" },
          geometry: { type: "Point", coordinates: [c.lng, c.lat] },
        });
      }
    }
    if (props.pinBKm != null) {
      const c = coordAtKm(props.coords, props.pinBKm);
      if (c) {
        features.push({
          type: "Feature",
          properties: { which: "B" },
          geometry: { type: "Point", coordinates: [c.lng, c.lat] },
        });
      }
    }
    src.setData({ type: "FeatureCollection", features });
  }, [props.pinAKm, props.pinBKm, props.coords, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("measure-segment") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const a: number | null = props.pinAKm;
    const b: number | null = props.pinBKm ?? (props.pinAKm != null ? props.hoverKm : null);
    if (a == null || b == null) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const poly = polylineBetween(props.coords, a, b);
    if (poly.length < 2) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: poly },
        },
      ],
    });
  }, [props.pinAKm, props.pinBKm, props.hoverKm, props.coords, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("streetview") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const on = props.showStreetViewLayer !== false;
    const pts = on ? (props.streetViewPoints ?? []) : [];
    src.setData({
      type: "FeatureCollection",
      features: pts.map((p) => ({
        type: "Feature" as const,
        properties: {
          pano_id: p.pano_id,
          lat: String(p.lat),
          lng: String(p.lng),
          along_km: String(p.along_km),
          maps_url: p.maps_url ?? "",
          label_km: `SV km ${p.along_km.toFixed(1)}`,
        },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    });
  }, [props.streetViewPoints, props.showStreetViewLayer, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const range = props.flyToKmRange;
    if (!range) return;
    const bounds = bboxLngLatForKmRange(props.coords, range.lo, range.hi);
    if (!bounds) return;
    try {
      map.fitBounds(bounds, { padding: 40, duration: 800, maxZoom: 15 });
    } catch {
      /* ignore */
    }
  }, [props.flyToKmRange, props.coords, mapReady]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        minHeight: "100dvh",
      }}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bounds [[west,south],[east,north]] per fitBounds MapLibre. */
function bboxLngLatForKmRange(
  coords: StoredCoord[],
  loKm: number,
  hiKm: number
): [[number, number], [number, number]] | null {
  const loK = Math.min(loKm, hiKm);
  const hiK = Math.max(loKm, hiKm);
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const c of coords) {
    const k = c[3];
    if (k < loK || k > hiK) continue;
    minLng = Math.min(minLng, c[0]);
    maxLng = Math.max(maxLng, c[0]);
    minLat = Math.min(minLat, c[1]);
    maxLat = Math.max(maxLat, c[1]);
  }
  if (!Number.isFinite(minLng)) return null;
  const pad = 0.003;
  return [
    [minLng - pad, minLat - pad],
    [maxLng + pad, maxLat + pad],
  ];
}
