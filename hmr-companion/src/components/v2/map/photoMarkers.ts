"use client";

import { useEffect, type MutableRefObject } from "react";
import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";

/** Distanza a schermo (px) sotto cui le foto si raggruppano. */
const CELL_PX = 64;
const MAX_MARKERS = 120;

type PhotoProps = { photoId?: string; url?: string; caption?: string };

/**
 * Foto sulla mappa come miniature (stile Komoot): raggruppate per cella a
 * schermo, con il numero di foto del gruppo. Click su gruppo → zoom (o
 * galleria se già vicino); click su foto → galleria da quella foto.
 */
export function usePhotoMarkers(
  mapRef: MutableRefObject<MaplibreMap | null>,
  mapReady: boolean,
  photos: GeoJSON.FeatureCollection | null | undefined,
  onSelectRef: MutableRefObject<((photoIds: string[], index: number) => void) | undefined>,
): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const items = (photos?.features ?? [])
      .filter((f) => f.geometry?.type === "Point" && (f.properties as PhotoProps | null)?.url)
      .map((f) => ({
        id: String((f.properties as PhotoProps).photoId ?? ""),
        url: String((f.properties as PhotoProps).url),
        caption: String((f.properties as PhotoProps).caption ?? ""),
        lngLat: (f.geometry as GeoJSON.Point).coordinates as [number, number],
      }));
    let markers: maplibregl.Marker[] = [];
    const allIds = items.map((p) => p.id);

    const render = () => {
      for (const m of markers) m.remove();
      markers = [];
      if (!items.length) return;
      const canvas = map.getCanvas();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      // Raggruppamento greedy per distanza a schermo: una miniatura non copre mai l'altra.
      const cells: { members: typeof items; x: number; y: number }[] = [];
      for (const p of items) {
        const pt = map.project(p.lngLat);
        if (pt.x < -CELL_PX || pt.y < -CELL_PX || pt.x > w + CELL_PX || pt.y > h + CELL_PX) continue;
        const c = cells.find((k) => Math.abs(k.x - pt.x) < CELL_PX && Math.abs(k.y - pt.y) < CELL_PX);
        if (c) c.members.push(p);
        else cells.push({ members: [p], x: pt.x, y: pt.y });
      }
      let n = 0;
      for (const c of cells) {
        if (n++ >= MAX_MARKERS) break;
        const first = c.members[0];
        const el = document.createElement("button");
        el.type = "button";
        el.className = "v2-photo-marker";
        el.setAttribute("aria-label", c.members.length > 1 ? `${c.members.length} foto` : first.caption || "Foto");
        el.style.cssText =
          "width:44px;height:44px;border-radius:10px;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);" +
          `background:#ec4899 center/cover no-repeat url("${first.url.replace(/"/g, "%22")}");cursor:pointer;padding:0;position:relative;`;
        if (c.members.length > 1) {
          const badge = document.createElement("span");
          badge.textContent = String(c.members.length);
          badge.style.cssText =
            "position:absolute;top:-8px;right:-8px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;" +
            "background:#111827;color:#fff;font:600 11px/20px system-ui,sans-serif;text-align:center;border:2px solid #fff;";
          el.appendChild(badge);
        }
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (c.members.length > 1 && map.getZoom() < 15.5) {
            const b = new maplibregl.LngLatBounds();
            for (const m of c.members) b.extend(m.lngLat);
            map.fitBounds(b, { padding: 80, maxZoom: 16.5, duration: 500 });
            return;
          }
          const ids = c.members.map((m) => m.id);
          // Galleria con prima le foto del gruppo, poi le altre visibili.
          const ordered = [...ids, ...allIds.filter((id) => !ids.includes(id))];
          onSelectRef.current?.(ordered, 0);
        });
        markers.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(first.lngLat).addTo(map));
      }
    };

    render();
    map.on("moveend", render);
    return () => {
      map.off("moveend", render);
      for (const m of markers) m.remove();
    };
  }, [mapRef, mapReady, photos, onSelectRef]);
}
