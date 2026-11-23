"use client";

import type { Map as MaplibreMap } from "maplibre-gl";
import { useEffect, useRef, type RefObject } from "react";
import { EMPTY_FC } from "@/components/v2/map/constants";
import { SKI_LINE_CLASSES, SKI_LINE_UNRATED } from "@/lib/ski-lines";
import { SNOW_SCALE } from "@/lib/snow-depth";
import type { MapOverlayId } from "@/lib/sports";

/**
 * Sovrapposizioni "dati" caricate per l'area visibile (non tile raster):
 * altezza neve (griglia Open-Meteo) e linee di sci (discese degli itinerari).
 */

const SNOW_SRC = "overlay-snow-depth";
const SKI_SRC = "overlay-ski-lines";

function ensureSnowLayers(map: MaplibreMap) {
  if (map.getSource(SNOW_SRC)) return;
  map.addSource(SNOW_SRC, { type: "geojson", data: EMPTY_FC });
  const before = map.getLayer("v2-poi-radius") ? "v2-poi-radius" : undefined;
  map.addLayer(
    {
      id: `${SNOW_SRC}-fill`,
      type: "fill",
      source: SNOW_SRC,
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.42, "fill-antialias": false },
    },
    before,
  );
  map.addLayer(
    {
      id: `${SNOW_SRC}-label`,
      type: "symbol",
      source: SNOW_SRC,
      minzoom: 11,
      layout: { "text-field": ["concat", ["to-string", ["get", "cm"]], " cm"], "text-size": 10.5, "text-allow-overlap": false },
      paint: { "text-color": "#1e3a8a", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
    },
    before,
  );
}

function ensureSkiLayers(map: MaplibreMap) {
  if (map.getSource(SKI_SRC)) return;
  map.addSource(SKI_SRC, { type: "geojson", data: EMPTY_FC });
  const before = map.getLayer("v2-poi-radius") ? "v2-poi-radius" : undefined;
  map.addLayer(
    {
      id: `${SKI_SRC}-casing`,
      type: "line",
      source: SKI_SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 15, 6], "line-opacity": 0.85 },
    },
    before,
  );
  map.addLayer(
    {
      id: `${SKI_SRC}-line`,
      type: "line",
      source: SKI_SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.4, 15, 3.6],
        "line-dasharray": [3, 1.2],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: `${SKI_SRC}-label`,
      type: "symbol",
      source: SKI_SRC,
      minzoom: 12.5,
      layout: {
        "symbol-placement": "line",
        "text-field": ["case", ["has", "rating"], ["concat", ["get", "name"], " · ", ["get", "rating"]], ["get", "name"]],
        "text-size": 10.5,
        "text-max-angle": 30,
      },
      paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
    },
    before,
  );
}

function setVisible(map: MaplibreMap, ids: string[], on: boolean) {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

function bboxParam(map: MaplibreMap): string {
  const b = map.getBounds();
  return `${b.getSouth().toFixed(4)},${b.getWest().toFixed(4)},${b.getNorth().toFixed(4)},${b.getEast().toFixed(4)}`;
}

export function useDataOverlays(
  mapRef: RefObject<MaplibreMap | null>,
  mapReady: boolean,
  styleEpoch: number,
  overlays: Partial<Record<MapOverlayId, boolean>>,
) {
  const snowOn = !!overlays.snow_depth;
  const skiOn = !!overlays.ski_lines;
  const seq = useRef(0);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (snowOn) ensureSnowLayers(map);
    if (skiOn) ensureSkiLayers(map);
    setVisible(map, [`${SNOW_SRC}-fill`, `${SNOW_SRC}-label`], snowOn);
    setVisible(map, [`${SKI_SRC}-casing`, `${SKI_SRC}-line`, `${SKI_SRC}-label`], skiOn);
    if (!snowOn && !skiOn) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      const my = ++seq.current;
      const q = bboxParam(map);
      const z = map.getZoom();
      if (snowOn && z >= 6) {
        void fetch(`/api/v2/snow/depth?bbox=${q}&zoom=${z.toFixed(1)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { geojson?: GeoJSON.FeatureCollection } | null) => {
            const src = map.getSource(SNOW_SRC) as maplibregl.GeoJSONSource | undefined;
            if (d?.geojson && src && my === seq.current) src.setData(d.geojson);
          })
          .catch(() => undefined);
      }
      if (skiOn && z >= 8) {
        void fetch(`/api/v2/ski/lines?bbox=${q}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { geojson?: GeoJSON.FeatureCollection } | null) => {
            const src = map.getSource(SKI_SRC) as maplibregl.GeoJSONSource | undefined;
            if (d?.geojson && src && my === seq.current) src.setData(d.geojson);
          })
          .catch(() => undefined);
      }
    };
    const onMove = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 450);
    };
    load();
    map.on("moveend", onMove);
    return () => {
      if (timer) clearTimeout(timer);
      map.off("moveend", onMove);
    };
  }, [mapRef, mapReady, styleEpoch, snowOn, skiOn]);
}

/** Legende compatte in basso a sinistra quando i livelli sono accesi. */
export function DataOverlayLegend({ overlays }: { overlays: Partial<Record<MapOverlayId, boolean>> }) {
  if (!overlays.snow_depth && !overlays.ski_lines) return null;
  return (
    <div className="ui-glass pointer-events-none absolute bottom-8 left-2.5 z-20 max-w-[220px] space-y-1.5 rounded-lg px-2.5 py-2 text-[10.5px]">
      {overlays.snow_depth ? (
        <div>
          <p className="font-semibold">Altezza neve (modello)</p>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {SNOW_SCALE.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
          <p className="mt-0.5 opacity-70">Open-Meteo, griglia ~2 km: indicativo</p>
        </div>
      ) : null}
      {overlays.ski_lines ? (
        <div>
          <p className="font-semibold">Linee di sci (Toponeige)</p>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {SKI_LINE_CLASSES.map((c) => (
              <span key={c.cls} className="inline-flex items-center gap-1">
                <span className="inline-block h-1 w-3 rounded" style={{ background: c.color }} />
                {c.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1 w-3 rounded" style={{ background: SKI_LINE_UNRATED }} />
              senza grado
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
