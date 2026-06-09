"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type TrackFeature = {
  type: "Feature";
  id: string;
  properties: {
    id: string;
    name: string;
    length_km: number;
    elev_gain_m: number;
    color: string;
    bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  };
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

type GeoJsonPayload = {
  type: "FeatureCollection";
  features: TrackFeature[];
};

const OSM_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
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
      attribution: "© OpenTopoMap",
      maxzoom: 17,
    },
  },
  layers: [
    { id: "osm", type: "raster", source: "osm" },
    { id: "terrain", type: "raster", source: "terrain", paint: { "raster-opacity": 0.3 } },
  ],
};

export default function PersonalMapOverview() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const router = useRouter();
  const [data, setData] = useState<GeoJsonPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch("/api/tracks/geojson", { credentials: "same-origin" });
      if (!res.ok) {
        if (!cancelled) setErr("Impossibile caricare le tracce.");
        setLoading(false);
        return;
      }
      const json = (await res.json()) as GeoJsonPayload;
      if (!cancelled) {
        setData(json);
        setErr(null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !data) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [12.5, 42.5],
      zoom: 5,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: true,
      }),
      "top-right"
    );

    map.on("load", () => {
      map.addSource("tracks", {
        type: "geojson",
        data: data as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: "tracks-casing",
        type: "line",
        source: "tracks",
        paint: { "line-color": "#0b1221", "line-width": 6, "line-opacity": 0.6 },
      });
      map.addLayer({
        id: "tracks-line",
        type: "line",
        source: "tracks",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-opacity": 0.9,
        },
      });

      if (data.features.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const f of data.features) {
          for (const c of f.geometry.coordinates) bounds.extend(c);
        }
        map.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 12 });
      }

      map.on("click", "tracks-line", (e) => {
        const f = e.features?.[0];
        const id = f?.properties?.id as string | undefined;
        if (id) router.push(`/track/${encodeURIComponent(id)}`);
      });
      map.on("mouseenter", "tracks-line", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "tracks-line", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data, router]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold">Mappa overview</h1>
          <p className="text-[10px] text-[color:var(--hmr-muted)]">
            {loading ? "Caricamento…" : `${data?.features.length ?? 0} tracce — clicca una linea per aprire`}
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/record" className="hmr-btn hmr-tap px-3 text-xs">
            Registra
          </a>
          <a href="/" className="hmr-btn hmr-tap px-3 text-xs">
            Libreria
          </a>
        </div>
      </header>
      {err && (
        <p className="shrink-0 px-3 py-2 text-xs text-[color:var(--hmr-danger)]">{err}</p>
      )}
      {data && data.features.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-2 border-b border-[color:var(--hmr-border)] px-3 py-2">
          {data.features.map((f) => (
            <button
              key={f.properties.id}
              type="button"
              onClick={() => router.push(`/track/${encodeURIComponent(f.properties.id)}`)}
              className="hmr-chip hmr-chip-off hmr-tap text-[10px]"
              style={{ borderColor: `${f.properties.color}66`, color: f.properties.color }}
            >
              {f.properties.name} · {f.properties.length_km.toFixed(1)} km
            </button>
          ))}
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
