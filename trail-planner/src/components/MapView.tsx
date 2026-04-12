"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, LineString } from "geojson";
import type { MapPoiRow, StopRow } from "@/lib/types";
import { MAP_POI_CATEGORY_COLOR, mapPoiCategoryLabel } from "@/lib/map-poi-ui";
import { buildWindyEmbed2Url, buildWindyMainSiteUrl } from "@/lib/windy-embed";
import { usePlanner } from "@/context/PlannerProvider";

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
  onRemoveMapPoi?: (id: string) => void;
  className?: string;
};

function poiColor(category: string): string {
  return MAP_POI_CATEGORY_COLOR[category] ?? MAP_POI_CATEGORY_COLOR.other;
}

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
  onRemoveMapPoi,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const clickRef = useRef(onMapBackgroundClick);
  clickRef.current = onMapBackgroundClick;
  const mapPoisRef = useRef(mapPois);
  mapPoisRef.current = mapPois;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
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
  const { windyOverlay, setWindyOverlay } = usePlanner();
  const windySyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ancora temporale fissa per la timeline previsione (non radar). */
  const windyTimeAnchorRef = useRef<number | null>(null);
  const [windyHourStep, setWindyHourStep] = useState(0);

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

    const points: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: stops.map((s) => {
        const lng = dragPos?.stopId === s.id ? dragPos.lng : s.lng;
        const lat = dragPos?.stopId === s.id ? dragPos.lat : s.lat;
        return {
          type: "Feature",
          properties: {
            name: s.name,
            stopId: s.id,
            hasPhoto: s.image_url ? 1 : 0,
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
          "circle-radius": ["case", [">", ["get", "hasPhoto"], 0], 9, 7],
          "circle-color": ["case", [">", ["get", "hasPhoto"], 0], "#fde047", "#fef08a"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#1e293b",
        },
      });
      map.addLayer({
        id: "stops-label",
        type: "symbol",
        source: "stops",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#fff",
          "text-halo-width": 1,
        },
      });
    } else {
      (map.getSource("stops") as maplibregl.GeoJSONSource).setData(points);
    }
  }, [mapReady, displayLine, stops, mapPois, color, dragPos]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;

    const lineLen = displayLine?.geometry?.coordinates?.length ?? 0;
    const sig = `${itineraryId ?? ""}|${stops.length}|${mapPois.length}|${lineLen}`;
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
    for (const s of stops) {
      bounds.extend([s.lng, s.lat]);
      has = true;
    }
    for (const p of mapPois) {
      bounds.extend([p.lng, p.lat]);
      has = true;
    }
    if (has) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 500 });
    }
  }, [mapReady, itineraryId, displayLine, stops, mapPois]);

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
              setSelectedPoi(poi);
              hitExplore = true;
            }
          }
        }
      }
      if (hitExplore) return;

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
