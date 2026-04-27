"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type { ExplorePlaceRow, MapPoiRow, StopRow } from "@/lib/types";
import type { TrailServicePoi } from "@/lib/overpass";
import { MAP_POI_CATEGORY_COLOR, mapPoiCategoryLabel } from "@/lib/map-poi-ui";
import { buildWindyEmbed2Url, buildWindyMainSiteUrl } from "@/lib/windy-embed";
import { trackSnapMaxDistKm } from "@/lib/map-track-ui";
import { isPassThroughPoint } from "@/lib/stop-segment";
import { nearestPointOnPolyline } from "@/lib/track-geometry";
import { usePlanner } from "@/context/PlannerProvider";
import type { MapPanelMode } from "@/lib/planner-events";
import { googleMapsSearchUrl } from "@/lib/maps-links";
import type { Position } from "geojson";

const ACTIVITY_COLORS: Record<string, string> = {
  road_bike: "#2563eb",
  mtb: "#16a34a",
  gravel: "#ca8a04",
  hiking: "#9333ea",
  running: "#dc2626",
  ski_mountaineering: "#0891b2",
  trail_running: "#ea580c",
  nordic_ski: "#0d9488",
};

type Props = {
  displayLine: Feature<LineString> | null;
  stops: StopRow[];
  mapPois: MapPoiRow[];
  activity: string;
  /** Click su area vuota (non su tappa né POI esplora). */
  onMapBackgroundClick: (lng: number, lat: number) => void;
  /** Click / tap su tappa (se drag disabilitato o click senza trascinamento). */
  onStopSelect?: (stop: StopRow) => void;
  /** Fine trascinamento tappa sulla mappa. */
  onStopDragEnd?: (stopId: string, lng: number, lat: number) => void;
  /** Se false, niente drag tappa (es. modalità «sposta su mappa»). Default true. */
  allowStopDrag?: boolean;
  /** Cambio itinerario: ricalcola il fit mappa (stessi numeri di tappe ma bbox diversa). */
  itineraryId?: string | null;
  /** Se impostato, mostra solo queste tappe (percorso parziale). */
  visibleStopIds?: Set<string> | null;
  /** Traccia completa per cursore → km in altimetria (anche se la linea è tagliata). */
  fullLineCoords?: Position[] | null;
  /** Cursore sulla traccia: km lungo linea se entro soglia (dipende dallo zoom), altrimenti null + distanza dal percorso. */
  onTrackHover?: (state: { alongKm: number | null; distKm: number }) => void;
  flyToRequest?: { lng: number; lat: number; zoom?: number } | null;
  onFlyToRequestConsumed?: () => void;
  onRemoveMapPoi?: (id: string) => void;
  className?: string;
  /** Cambio layout contenitore: serve MapLibre per ridimensionare. */
  mapPanelMode?: MapPanelMode;
  /** Feed sociale (uscite amici/gruppi) — linee tratteggiate sopra la traccia principale. */
  socialFeedGeojson?: FeatureCollection | null;
  /** Fontane / acqua OSM lungo bbox percorso (cerchi piccoli). */
  osmWaterPois?: { lat: number; lng: number }[];
  /** Rifugi e servizi quando l’utente attiva il toggle nel pannello OSM. */
  osmServicePois?: TrailServicePoi[];
  /** Luoghi dal catalogo Esplora (tabella locale, non solo POI itinerario). */
  catalogExplorePlaces?: ExplorePlaceRow[];
};

function poiColor(category: string): string {
  return MAP_POI_CATEGORY_COLOR[category] ?? MAP_POI_CATEGORY_COLOR.other;
}

const TRAIL_SERVICE_LABEL: Record<TrailServicePoi["kind"], string> = {
  hut: "Rifugio",
  bivouac: "Bivacco",
  shelter: "Riparo / ricovero",
  restaurant: "Ristoro",
};

export function MapView({
  displayLine,
  stops,
  mapPois,
  activity,
  onMapBackgroundClick,
  onStopSelect,
  onStopDragEnd,
  allowStopDrag = true,
  itineraryId = null,
  visibleStopIds = null,
  fullLineCoords = null,
  onTrackHover,
  flyToRequest = null,
  onFlyToRequestConsumed,
  onRemoveMapPoi,
  className,
  mapPanelMode = "compact",
  socialFeedGeojson = null,
  osmWaterPois = [],
  osmServicePois = [],
  catalogExplorePlaces = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const clickRef = useRef(onMapBackgroundClick);
  clickRef.current = onMapBackgroundClick;
  const mapPoisRef = useRef(mapPois);
  mapPoisRef.current = mapPois;
  const osmServicePoisRef = useRef(osmServicePois);
  osmServicePoisRef.current = osmServicePois;
  const stopsForMap =
    visibleStopIds != null
      ? stops.filter((s) => visibleStopIds.has(s.id))
      : stops;
  const stopsRef = useRef(stopsForMap);
  stopsRef.current = stopsForMap;
  const onTrackHoverRef = useRef(onTrackHover);
  onTrackHoverRef.current = onTrackHover;
  const fullLineCoordsRef = useRef(fullLineCoords);
  fullLineCoordsRef.current = fullLineCoords;
  const flyConsumedRef = useRef(onFlyToRequestConsumed);
  flyConsumedRef.current = onFlyToRequestConsumed;
  const onStopSelectRef = useRef(onStopSelect);
  onStopSelectRef.current = onStopSelect;
  const onStopDragEndRef = useRef(onStopDragEnd);
  onStopDragEndRef.current = onStopDragEnd;
  const suppressClickRef = useRef(false);
  const dragSessionRef = useRef<{
    stopId: string;
    startClient: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const [dragPos, setDragPos] = useState<{ stopId: string; lng: number; lat: number } | null>(null);
  const fitSigRef = useRef<string>("");
  const allowStopDragRef = useRef(allowStopDrag);
  allowStopDragRef.current = allowStopDrag;
  const [mapReady, setMapReady] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<MapPoiRow | null>(null);
  const [selectedOsmService, setSelectedOsmService] = useState<TrailServicePoi | null>(null);
  const { windyOverlay, setWindyOverlay } = usePlanner();
  const windySyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ancora temporale fissa per la timeline previsione (non radar). */
  const windyTimeAnchorRef = useRef<number | null>(null);
  const [windyHourStep, setWindyHourStep] = useState(0);
  /** Punto proiettato sulla traccia per marker rosso + hover altimetria. */
  const [trackSnap, setTrackSnap] = useState<{
    lng: number;
    lat: number;
    alongKm: number;
  } | null>(null);

  if (!windyOverlay) {
    windyTimeAnchorRef.current = null;
  } else if (windyTimeAnchorRef.current === null) {
    windyTimeAnchorRef.current = Date.now();
  }

  const color = ACTIVITY_COLORS[activity] ?? "#6366f1";

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [11.12, 46.07],
      zoom: 9,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => {
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getLayer("osm")) return;
    try {
      map.setPaintProperty("osm", "raster-opacity", windyOverlay ? 0 : 1);
    } catch {
      /* ignore */
    }
  }, [mapReady, windyOverlay]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    requestAnimationFrame(() => map.resize());
  }, [mapReady, windyOverlay]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    requestAnimationFrame(() => map.resize());
  }, [mapReady, mapPanelMode]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const data: FeatureCollection = socialFeedGeojson ?? {
      type: "FeatureCollection",
      features: [],
    };
    if (!map.getSource("social-feed")) {
      map.addSource("social-feed", { type: "geojson", data });
      map.addLayer({
        id: "social-feed-line",
        type: "line",
        source: "social-feed",
        paint: {
          "line-color": "#c084fc",
          "line-width": 3,
          "line-opacity": 0.72,
          "line-dasharray": [1.2, 1.2],
        },
      });
    } else {
      (map.getSource("social-feed") as maplibregl.GeoJSONSource).setData(data);
    }
  }, [mapReady, socialFeedGeojson]);

  useEffect(() => {
    if (!mapReady || !containerRef.current || !mapRef.current) return;
    const map = mapRef.current;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => map.resize());
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady || !windyOverlay) return;
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      if (windySyncTimer.current) clearTimeout(windySyncTimer.current);
      windySyncTimer.current = setTimeout(() => {
        const c = map.getCenter();
        const z = Math.round(map.getZoom() * 10) / 10;
        setWindyOverlay({ lat: c.lat, lng: c.lng, zoom: z });
      }, 400);
    };
    map.on("moveend", sync);
    return () => {
      map.off("moveend", sync);
      if (windySyncTimer.current) clearTimeout(windySyncTimer.current);
    };
  }, [mapReady, windyOverlay, setWindyOverlay]);

  const wasWindyRef = useRef(false);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (!windyOverlay) {
      wasWindyRef.current = false;
      return;
    }
    const map = mapRef.current;
    if (!wasWindyRef.current) {
      map.flyTo({
        center: [windyOverlay.lng, windyOverlay.lat],
        zoom: windyOverlay.zoom,
        duration: 650,
      });
    }
    wasWindyRef.current = true;
  }, [mapReady, windyOverlay]);

  useEffect(() => {
    if (!windyOverlay) setWindyHourStep(0);
  }, [windyOverlay]);

  /** Timeline previsione ECMWF: avanza l’ora (embed Windy non ha autoplay ufficiale). */
  useEffect(() => {
    if (!windyOverlay) return;
    const id = setInterval(() => {
      setWindyHourStep((h) => (h >= 47 ? 0 : h + 1));
    }, 2600);
    return () => clearInterval(id);
  }, [windyOverlay]);

  useEffect(() => {
    if (!mapReady || !flyToRequest || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [flyToRequest.lng, flyToRequest.lat],
      zoom: flyToRequest.zoom ?? 13,
      duration: 800,
    });
    flyConsumedRef.current?.();
  }, [mapReady, flyToRequest]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (dragSessionRef.current) return;
      const canvas = map.getCanvas();
      const cb = onTrackHoverRef.current;
      const coords = fullLineCoordsRef.current;

      const hitPoi =
        map.getLayer("explore-poi-circles") &&
        map.queryRenderedFeatures(e.point, { layers: ["explore-poi-circles"] }).length > 0;
      const hitCatalog =
        map.getLayer("catalog-explore-circles") &&
        map.queryRenderedFeatures(e.point, { layers: ["catalog-explore-circles"] }).length > 0;
      const hitStop =
        map.getLayer("stops-circle") &&
        map.queryRenderedFeatures(e.point, { layers: ["stops-circle"] }).length > 0;
      if (hitPoi || hitCatalog || hitStop) {
        setTrackSnap(null);
        cb?.({ alongKm: null, distKm: Number.POSITIVE_INFINITY });
        return;
      }

      if (!coords?.length || !cb) {
        setTrackSnap(null);
        cb?.({ alongKm: null, distKm: Number.POSITIVE_INFINITY });
        canvas.style.cursor = "";
        return;
      }
      const n = nearestPointOnPolyline(coords, [e.lngLat.lng, e.lngLat.lat]);
      const maxD = trackSnapMaxDistKm(map.getZoom());
      if (n && n.distKm < maxD) {
        cb({ alongKm: n.alongKm, distKm: n.distKm });
        setTrackSnap({ lng: n.closest[0], lat: n.closest[1], alongKm: n.alongKm });
        canvas.style.cursor = "crosshair";
      } else {
        cb({ alongKm: null, distKm: n?.distKm ?? Number.POSITIVE_INFINITY });
        setTrackSnap(null);
        canvas.style.cursor = "";
      }
    };
    const onLeave = () => {
      onTrackHoverRef.current?.({ alongKm: null, distKm: Number.POSITIVE_INFINITY });
      setTrackSnap(null);
      map.getCanvas().style.cursor = "";
    };
    map.on("mousemove", onMove);
    map.getCanvas().addEventListener("mouseleave", onLeave);
    return () => {
      map.off("mousemove", onMove);
      map.getCanvas().removeEventListener("mouseleave", onLeave);
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.getSource("track-snap")) return;
    const fc: GeoJSON.FeatureCollection =
      trackSnap != null
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [trackSnap.lng, trackSnap.lat] },
              },
            ],
          }
        : { type: "FeatureCollection", features: [] };
    (map.getSource("track-snap") as maplibregl.GeoJSONSource).setData(fc);
  }, [mapReady, trackSnap]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;

    const routeGeo: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: displayLine ? [displayLine] : [],
    };

    if (!map.getSource("route")) {
      map.addSource("route", { type: "geojson", data: routeGeo });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": color,
          "line-width": 4,
          "line-opacity": 0.85,
        },
      });
    } else {
      (map.getSource("route") as maplibregl.GeoJSONSource).setData(routeGeo);
      map.setPaintProperty("route-line", "line-color", color);
    }

    const emptySnap: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    if (!map.getSource("track-snap")) {
      map.addSource("track-snap", { type: "geojson", data: emptySnap });
      map.addLayer({
        id: "track-snap-dot",
        type: "circle",
        source: "track-snap",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ef4444",
          "circle-opacity": 0.95,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fafafa",
        },
      });
    }

    const exploreFc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: mapPois.map((p) => ({
        type: "Feature" as const,
        properties: {
          id: p.id,
          name: p.name,
          color: poiColor(p.category),
        },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      })),
    };

    if (!map.getSource("explore-pois")) {
      map.addSource("explore-pois", { type: "geojson", data: exploreFc });
      map.addLayer({
        id: "explore-poi-circles",
        type: "circle",
        source: "explore-pois",
        paint: {
          "circle-radius": 11,
          "circle-color": ["get", "color"],
          "circle-opacity": 0.92,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fafafa",
        },
      });
      map.addLayer({
        id: "explore-poi-label",
        type: "symbol",
        source: "explore-pois",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-offset": [0, 1.35],
          "text-anchor": "top",
          "text-max-width": 12,
        },
        paint: {
          "text-color": "#f4f4f5",
          "text-halo-color": "#18181b",
          "text-halo-width": 1.2,
        },
      });
    } else {
      (map.getSource("explore-pois") as maplibregl.GeoJSONSource).setData(exploreFc);
    }

    const catalogFc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: catalogExplorePlaces.map((p) => ({
        type: "Feature" as const,
        properties: {
          id: p.id,
          name: p.name,
        },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      })),
    };

    if (!map.getSource("catalog-explore")) {
      map.addSource("catalog-explore", { type: "geojson", data: catalogFc });
      map.addLayer({
        id: "catalog-explore-circles",
        type: "circle",
        source: "catalog-explore",
        paint: {
          "circle-radius": 8,
          "circle-color": "#a855f7",
          "circle-opacity": 0.88,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fafafa",
        },
      });
      map.addLayer({
        id: "catalog-explore-label",
        type: "symbol",
        source: "catalog-explore",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 9,
          "text-offset": [0, 1.15],
          "text-anchor": "top",
          "text-max-width": 10,
        },
        paint: {
          "text-color": "#e9d5ff",
          "text-halo-color": "#18181b",
          "text-halo-width": 1,
        },
      });
    } else {
      (map.getSource("catalog-explore") as maplibregl.GeoJSONSource).setData(catalogFc);
    }

    const points: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: stopsForMap.map((s) => {
        const lng = dragPos?.stopId === s.id ? dragPos.lng : s.lng;
        const lat = dragPos?.stopId === s.id ? dragPos.lat : s.lat;
        return {
          type: "Feature",
          properties: {
            name: s.name,
            stopId: s.id,
            hasPhoto: s.image_url ? 1 : 0,
            wr: s.waypoint_role,
            passThrough: isPassThroughPoint(s) ? 1 : 0,
          },
          geometry: { type: "Point", coordinates: [lng, lat] },
        };
      }),
    };

    if (!map.getSource("stops")) {
      map.addSource("stops", { type: "geojson", data: points });
      map.addLayer({
        id: "stops-circle",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "passThrough"], 1],
            ["case", [">", ["get", "hasPhoto"], 0], 6, 4],
            [
              "case",
              [">", ["get", "hasPhoto"], 0],
              9,
              [
                "match",
                ["get", "wr"],
                "trip_start",
                10,
                "trip_end",
                10,
                "leg_start",
                8,
                "leg_end",
                8,
                "via",
                6,
                "poi",
                5,
                7,
              ],
            ],
          ],
          "circle-color": [
            "case",
            ["==", ["get", "passThrough"], 1],
            ["case", [">", ["get", "hasPhoto"], 0], "#fde047", "#94a3b8"],
            [
              "case",
              [">", ["get", "hasPhoto"], 0],
              "#fde047",
              [
                "match",
                ["get", "wr"],
                "trip_start",
                "#22c55e",
                "trip_end",
                "#fb7185",
                "leg_start",
                "#38bdf8",
                "leg_end",
                "#fb923c",
                "via",
                "#cbd5e1",
                "poi",
                "#94a3b8",
                "#cbd5e1",
              ],
            ],
          ],
          "circle-stroke-width": [
            "case",
            ["==", ["get", "passThrough"], 1],
            1.5,
            2,
          ],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "passThrough"], 1],
            ["case", [">", ["get", "hasPhoto"], 0], "#1e293b", "#475569"],
            [
              "case",
              [">", ["get", "hasPhoto"], 0],
              "#1e293b",
              [
                "match",
                ["get", "wr"],
                "trip_start",
                "#14532d",
                "trip_end",
                "#9f1239",
                "leg_start",
                "#075985",
                "leg_end",
                "#9a3412",
                "via",
                "#334155",
                "poi",
                "#475569",
                "#334155",
              ],
            ],
          ],
        },
      });
      map.addLayer({
        id: "stops-label",
        type: "symbol",
        source: "stops",
        layout: {
          "text-field": ["get", "name"],
          "text-size": ["case", ["==", ["get", "passThrough"], 1], 9, 11],
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: {
          "text-color": ["case", ["==", ["get", "passThrough"], 1], "#94a3b8", "#0f172a"],
          "text-halo-color": "#fff",
          "text-halo-width": 1,
        },
      });
    } else {
      (map.getSource("stops") as maplibregl.GeoJSONSource).setData(points);
    }
  }, [mapReady, displayLine, stopsForMap, mapPois, catalogExplorePlaces, color, dragPos]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;

    const waterFc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: osmWaterPois.map((p, i) => ({
        type: "Feature" as const,
        properties: { i },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      })),
    };
    const svcFc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: osmServicePois.map((p, idx) => ({
        type: "Feature" as const,
        properties: { kind: p.kind, name: p.name ?? "", idx },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      })),
    };

    if (!map.getSource("osm-water")) {
      map.addSource("osm-water", { type: "geojson", data: waterFc });
      map.addLayer({
        id: "osm-water-circles",
        type: "circle",
        source: "osm-water",
        paint: {
          "circle-radius": 3.5,
          "circle-color": "#22d3ee",
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#164e63",
        },
      });
    } else {
      (map.getSource("osm-water") as maplibregl.GeoJSONSource).setData(waterFc);
    }

    if (!map.getSource("osm-services")) {
      map.addSource("osm-services", { type: "geojson", data: svcFc });
      map.addLayer({
        id: "osm-services-circles",
        type: "circle",
        source: "osm-services",
        paint: {
          "circle-radius": 4,
          "circle-color": [
            "match",
            ["get", "kind"],
            "hut",
            "#fb923c",
            "bivouac",
            "#c084fc",
            "shelter",
            "#94a3b8",
            "restaurant",
            "#fde047",
            "#64748b",
          ],
          "circle-opacity": 0.92,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#1e293b",
        },
      });
    } else {
      (map.getSource("osm-services") as maplibregl.GeoJSONSource).setData(svcFc);
    }
  }, [mapReady, osmWaterPois, osmServicePois]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;

    const lineLen = displayLine?.geometry?.coordinates?.length ?? 0;
    const sig = `${itineraryId ?? ""}|${stopsForMap.length}|${mapPois.length}|${catalogExplorePlaces.length}|${lineLen}`;
    if (sig === fitSigRef.current) return;
    fitSigRef.current = sig;

    const bounds = new maplibregl.LngLatBounds();
    let has = false;
    if (displayLine?.geometry?.coordinates?.length) {
      for (const c of displayLine.geometry.coordinates) {
        bounds.extend(c as [number, number]);
        has = true;
      }
    }
    for (const s of stopsForMap) {
      bounds.extend([s.lng, s.lat]);
      has = true;
    }
    for (const p of mapPois) {
      bounds.extend([p.lng, p.lat]);
      has = true;
    }
    for (const p of catalogExplorePlaces) {
      bounds.extend([p.lng, p.lat]);
      has = true;
    }
    if (has) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 500 });
    }
  }, [mapReady, itineraryId, displayLine, stopsForMap, mapPois, catalogExplorePlaces]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    const handler = (e: maplibregl.MapMouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      let hitExplore = false;
      if (map.getLayer("explore-poi-circles")) {
        const feats = map.queryRenderedFeatures(e.point, { layers: ["explore-poi-circles"] });
        if (feats.length) {
          const id = feats[0].properties?.id as string | undefined;
          if (id) {
            const poi = mapPoisRef.current.find((p) => p.id === id);
            if (poi) {
              setSelectedOsmService(null);
              setSelectedPoi(poi);
              hitExplore = true;
            }
          }
        }
      }
      if (hitExplore) return;

      if (map.getLayer("catalog-explore-circles")) {
        const catHits = map.queryRenderedFeatures(e.point, { layers: ["catalog-explore-circles"] });
        if (catHits.length) return;
      }

      if (map.getLayer("osm-services-circles")) {
        const svcHits = map.queryRenderedFeatures(e.point, { layers: ["osm-services-circles"] });
        if (svcHits.length) {
          const idx = svcHits[0].properties?.idx as number | undefined;
          const p =
            idx != null && Number.isFinite(idx) ? osmServicePoisRef.current[idx] : undefined;
          if (p) {
            setSelectedPoi(null);
            setSelectedOsmService(p);
            return;
          }
        }
      }

      if (
        !allowStopDragRef.current &&
        map.getLayer("stops-circle") &&
        onStopSelectRef.current
      ) {
        const pad = 22;
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ];
        const stopHits = map.queryRenderedFeatures(box, { layers: ["stops-circle"] });
        if (stopHits.length) {
          const sid = stopHits[0].properties?.stopId as string | undefined;
          if (sid) {
            const st = stopsRef.current.find((s) => s.id === sid);
            if (st) {
              setSelectedPoi(null);
              onStopSelectRef.current(st);
              return;
            }
          }
        }
      }

      setSelectedPoi(null);
      setSelectedOsmService(null);
      clickRef.current(e.lngLat.lng, e.lngLat.lat);
    };

    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady || !allowStopDrag) return;
    const map = mapRef.current;
    if (!map?.getLayer("stops-circle")) return;

    const onDown = (e: maplibregl.MapLayerMouseEvent) => {
      const sid = e.features?.[0]?.properties?.stopId as string | undefined;
      if (!sid) return;
      e.preventDefault();
      map.dragPan.disable();
      dragSessionRef.current = {
        stopId: sid,
        startClient: { x: e.originalEvent.clientX, y: e.originalEvent.clientY },
        moved: false,
      };
    };

    const onWinMove = (e: MouseEvent) => {
      const d = dragSessionRef.current;
      if (!d || !mapRef.current) return;
      const m = mapRef.current;
      const dx = e.clientX - d.startClient.x;
      const dy = e.clientY - d.startClient.y;
      if (dx * dx + dy * dy <= 36) return;
      d.moved = true;
      const rect = m.getContainer().getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const lngLat = m.unproject([x, y]);
      setDragPos({ stopId: d.stopId, lng: lngLat.lng, lat: lngLat.lat });
    };

    const onWinUp = (e: MouseEvent) => {
      const d = dragSessionRef.current;
      if (!d || !mapRef.current) return;
      const m = mapRef.current;
      m.dragPan.enable();
      dragSessionRef.current = null;
      setDragPos(null);

      const rect = m.getContainer().getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const lngLat = m.unproject([x, y]);

      suppressClickRef.current = true;
      const st = stopsRef.current.find((s) => s.id === d.stopId);
      if (!st) return;
      if (d.moved) {
        onStopDragEndRef.current?.(d.stopId, lngLat.lng, lngLat.lat);
      } else {
        onStopSelectRef.current?.(st);
      }
    };

    map.on("mousedown", "stops-circle", onDown);
    window.addEventListener("mousemove", onWinMove);
    window.addEventListener("mouseup", onWinUp);
    return () => {
      map.off("mousedown", "stops-circle", onDown);
      window.removeEventListener("mousemove", onWinMove);
      window.removeEventListener("mouseup", onWinUp);
      if (dragSessionRef.current && mapRef.current) {
        mapRef.current.dragPan.enable();
        dragSessionRef.current = null;
        setDragPos(null);
      }
    };
  }, [mapReady, allowStopDrag]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.getLayer("osm-services-circles")) return;
    const enter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("mouseenter", "osm-services-circles", enter);
    map.on("mouseleave", "osm-services-circles", leave);
    return () => {
      map.off("mouseenter", "osm-services-circles", enter);
      map.off("mouseleave", "osm-services-circles", leave);
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.getLayer("explore-poi-circles")) return;
    const enter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("mouseenter", "explore-poi-circles", enter);
    map.on("mouseleave", "explore-poi-circles", leave);
    return () => {
      map.off("mouseenter", "explore-poi-circles", enter);
      map.off("mouseleave", "explore-poi-circles", leave);
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.getLayer("catalog-explore-circles")) return;
    const enter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("mouseenter", "catalog-explore-circles", enter);
    map.on("mouseleave", "catalog-explore-circles", leave);
    return () => {
      map.off("mouseenter", "catalog-explore-circles", enter);
      map.off("mouseleave", "catalog-explore-circles", leave);
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.getLayer("stops-circle")) return;
    const enter = () => {
      map.getCanvas().style.cursor = allowStopDrag ? "grab" : "pointer";
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("mouseenter", "stops-circle", enter);
    map.on("mouseleave", "stops-circle", leave);
    return () => {
      map.off("mouseenter", "stops-circle", enter);
      map.off("mouseleave", "stops-circle", leave);
    };
  }, [mapReady, allowStopDrag]);

  const windySrc =
    windyOverlay && windyTimeAnchorRef.current !== null
      ? buildWindyEmbed2Url({
          lat: windyOverlay.lat,
          lng: windyOverlay.lng,
          zoom: windyOverlay.zoom,
          forecastTimeMs: windyTimeAnchorRef.current + windyHourStep * 3600000,
        })
      : null;
  const windy = windyOverlay;

  return (
    <div
      className={`relative h-full min-h-0 w-full overflow-hidden rounded-lg border border-zinc-700/50 ${className ?? ""}`}
    >
      {windySrc ? (
        <>
          <iframe
            title="Windy — pioggia e fulmini (ECMWF)"
            src={windySrc}
            className="pointer-events-none absolute inset-0 z-[1] h-full w-full border-0 bg-slate-900"
          />
          <div className="pointer-events-auto absolute left-2 top-2 z-[40] flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5 rounded-md border border-sky-500/45 bg-zinc-950/92 px-2 py-1 text-[10px] text-sky-100 shadow-md backdrop-blur-sm">
            <span className="font-medium text-sky-200">Windy</span>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-400">pioggia/tuoni ECMWF · timeline</span>
            <a
              className="rounded bg-sky-800/90 px-1.5 py-0.5 text-[9px] text-white hover:bg-sky-700"
              href={
                windy ? buildWindyMainSiteUrl(windy.lat, windy.lng, windy.zoom) : "https://www.windy.com/"
              }
              target="_blank"
              rel="noreferrer"
            >
              windy.com
            </a>
            <button
              type="button"
              className="rounded bg-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-200 hover:bg-zinc-600"
              onClick={() => setWindyOverlay(null)}
            >
              Torna mappa OSM
            </button>
          </div>
        </>
      ) : null}
      <div
        ref={containerRef}
        className="relative z-[15] h-full w-full min-h-[200px]"
      />
      {selectedOsmService && (
        <div className="pointer-events-auto absolute bottom-2 left-2 right-2 z-[46] max-h-[min(55vh,420px)] overflow-y-auto rounded-lg border border-orange-700/50 bg-zinc-950/98 p-3 shadow-xl backdrop-blur-sm md:left-auto md:right-2 md:max-w-sm">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-medium uppercase text-orange-400/95">
                {TRAIL_SERVICE_LABEL[selectedOsmService.kind]} · OpenStreetMap
              </p>
              <h3 className="text-sm font-semibold text-zinc-50">
                {selectedOsmService.name ?? "Senza nome"}
              </h3>
            </div>
            <button
              type="button"
              className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-700"
              onClick={() => setSelectedOsmService(null)}
            >
              Chiudi
            </button>
          </div>
          {selectedOsmService.image_url ? (
            <div className="mb-2 overflow-hidden rounded-md border border-zinc-700/80">
              <img
                src={selectedOsmService.image_url}
                alt=""
                className="max-h-52 w-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : null}
          {selectedOsmService.description ? (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
              {selectedOsmService.description}
            </p>
          ) : (
            <p className="text-xs text-zinc-500">Nessuna descrizione su OSM per questo punto.</p>
          )}
          <p className="mt-2 text-[10px] text-zinc-500">
            {selectedOsmService.lat.toFixed(5)}, {selectedOsmService.lng.toFixed(5)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedOsmService.website ? (
              <a
                href={selectedOsmService.website}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-emerald-800 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-700"
              >
                Prenota / sito
              </a>
            ) : null}
            {selectedOsmService.phone ? (
              <a
                href={`tel:${selectedOsmService.phone.trim()}`}
                className="rounded bg-zinc-700 px-3 py-1.5 text-[11px] text-zinc-100 hover:bg-zinc-600"
              >
                Chiama
              </a>
            ) : null}
            <a
              href={googleMapsSearchUrl(
                selectedOsmService.lat,
                selectedOsmService.lng,
                selectedOsmService.name ?? "rifugio"
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-zinc-600 px-3 py-1.5 text-[11px] text-sky-400 hover:bg-zinc-800"
            >
              Google Maps
            </a>
          </div>
        </div>
      )}
      {selectedPoi && (
        <div className="pointer-events-auto absolute bottom-2 left-2 right-2 z-[45] max-h-[min(55vh,380px)] overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-950/98 p-3 shadow-xl backdrop-blur-sm md:left-auto md:right-2 md:max-w-sm">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-medium uppercase text-emerald-500/90">
                {mapPoiCategoryLabel(selectedPoi.category)}
              </p>
              <h3 className="text-sm font-semibold text-zinc-50">{selectedPoi.name}</h3>
            </div>
            <button
              type="button"
              className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-700"
              onClick={() => setSelectedPoi(null)}
            >
              Chiudi
            </button>
          </div>
          {selectedPoi.image_url ? (
            <div className="mb-2 overflow-hidden rounded-md border border-zinc-700/80">
              <img
                src={selectedPoi.image_url}
                alt=""
                className="max-h-48 w-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : null}
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
            {selectedPoi.description || "Nessuna descrizione."}
          </p>
          <p className="mt-2 text-[10px] text-zinc-500">
            {selectedPoi.lat.toFixed(5)}, {selectedPoi.lng.toFixed(5)}
          </p>
          <p className="mt-1 text-[11px]">
            <a
              href={googleMapsSearchUrl(selectedPoi.lat, selectedPoi.lng, selectedPoi.name)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 underline hover:text-sky-300"
            >
              Apri in Google Maps
            </a>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedPoi.website_url && /^https?:\/\//i.test(selectedPoi.website_url.trim()) ? (
              <a
                href={selectedPoi.website_url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-emerald-800/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
              >
                Sito / prenota
              </a>
            ) : null}
            {selectedPoi.phone?.trim() ? (
              <a
                href={`tel:${selectedPoi.phone.trim()}`}
                className="rounded bg-zinc-700 px-2.5 py-1 text-[11px] text-zinc-100 hover:bg-zinc-600"
              >
                Chiama
              </a>
            ) : null}
          </div>
          {onRemoveMapPoi ? (
            <button
              type="button"
              className="mt-3 w-full rounded border border-red-900/60 bg-red-950/40 py-1.5 text-xs text-red-200/90 hover:bg-red-950/70"
              onClick={() => {
                void onRemoveMapPoi(selectedPoi.id);
                setSelectedPoi(null);
              }}
            >
              Rimuovi dalla mappa
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
