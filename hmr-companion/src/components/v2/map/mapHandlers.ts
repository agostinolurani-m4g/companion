import type { MutableRefObject } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import type maplibregl from "maplibre-gl";
import type { V2SearchPoi } from "@/app/api/v2/pois/search/route";
import type { V2MapClickTarget, V2Waypoint } from "./types";

export type MapHandlerRefs = {
  onInteractionRef: MutableRefObject<(target: V2MapClickTarget) => void>;
  onWaypointMoveRef: MutableRefObject<((index: number, lng: number, lat: number) => void) | undefined>;
  onRouteDragStartRef?: MutableRefObject<((lng: number, lat: number) => number | null) | undefined>;
  poisRef: MutableRefObject<V2SearchPoi[]>;
  waypointsRef: MutableRefObject<V2Waypoint[]>;
  /** `fromRoute`: gesto partito dalla linea; la tappa nasce solo quando il mouse si muove davvero. */
  dragRef: MutableRefObject<{
    index: number;
    startX: number;
    startY: number;
    moved: boolean;
    fromRoute?: { lng: number; lat: number };
  } | null>;
  suppressClickRef: MutableRefObject<boolean>;
  onRouteSelectRef: MutableRefObject<((routeId: string) => void) | undefined>;
  onReportSelectRef: MutableRefObject<((reportId: string) => void) | undefined>;
  outdoorFeaturesRef?: MutableRefObject<GeoJSON.FeatureCollection | null>;
  allowOutdoorPickRef: MutableRefObject<boolean>;
  allowLabelPickRef?: MutableRefObject<boolean>;
};

const PLACE_CLASS_LABEL: Record<string, string> = {
  city: "Città",
  town: "Paese",
  village: "Paese",
  suburb: "Quartiere",
  hamlet: "Frazione",
  isolated_dwelling: "Località",
  locality: "Località",
  neighbourhood: "Quartiere",
  country: "Stato",
  state: "Regione",
  province: "Provincia",
};

const POI_SUBCLASS_LABEL: Record<string, string> = {
  alpine_hut: "Rifugio",
  wilderness_hut: "Bivacco",
  viewpoint: "Punto panoramico",
  attraction: "Attrazione",
  museum: "Museo",
  castle: "Castello",
  ruins: "Rovine",
  church: "Chiesa",
  place_of_worship: "Luogo di culto",
  monument: "Monumento",
};

function labelKind(sourceLayer: string, props: Record<string, unknown>): string | null {
  const cls = String(props.class ?? "");
  const sub = String(props.subclass ?? "");
  switch (sourceLayer) {
    case "mountain_peak":
      if (cls === "saddle") return "Passo / colle";
      if (cls === "volcano") return "Vulcano";
      if (cls === "ridge" || cls === "arete") return "Cresta";
      return "Vetta";
    case "place":
      return PLACE_CLASS_LABEL[cls] ?? "Località";
    case "water_name":
      return cls === "lake" ? "Lago" : cls === "bay" ? "Baia" : "Acque";
    case "waterway":
      return cls === "river" ? "Fiume" : "Torrente";
    case "park":
      return "Parco / area protetta";
    case "aerodrome_label":
      return "Aeroporto";
    case "poi":
      return POI_SUBCLASS_LABEL[sub] ?? POI_SUBCLASS_LABEL[cls] ?? null;
    default:
      return null;
  }
}

/** Etichetta della mappa base sotto il click (vetta, paese, lago…), se c'è un nome. */
function pickBaseLabel(map: MaplibreMap, point: { x: number; y: number }) {
  const pad = 8;
  const feats = map.queryRenderedFeatures([
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ]);
  for (const f of feats) {
    if (f.layer.type !== "symbol" || !f.sourceLayer) continue;
    if (f.layer.id.startsWith("v2-") || f.layer.id.startsWith("ski-")) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const name = String(props["name:it"] ?? props.name ?? props.name_int ?? "").trim();
    if (!name) continue;
    const kindLabel = labelKind(f.sourceLayer, props);
    if (!kindLabel) continue;
    let lng: number;
    let lat: number;
    if (f.geometry.type === "Point") {
      [lng, lat] = f.geometry.coordinates as [number, number];
    } else {
      const ll = map.unproject([point.x, point.y]);
      lng = ll.lng;
      lat = ll.lat;
    }
    const eleRaw = Number(props.ele);
    return {
      id: `map:${f.sourceLayer}:${f.id ?? `${name}@${lat.toFixed(4)},${lng.toFixed(4)}`}`,
      name,
      kindLabel,
      lat,
      lng,
      ele: Number.isFinite(eleRaw) && eleRaw > 0 ? eleRaw : null,
      wikidata: typeof props.wikidata === "string" ? props.wikidata : null,
    };
  }
  return null;
}

export function bindLayerHandlers(map: MaplibreMap, refs: MapHandlerRefs): () => void {
  const interactiveLayers = ["v2-pois-hit", "v2-outdoor-hit", "v2-waypoints", "v2-waypoints-halo", "v2-reports-hit"];
  const onLayerEnter = () => {
    if (!refs.dragRef.current) map.getCanvas().style.cursor = "pointer";
  };
  const onLayerLeave = () => {
    if (!refs.dragRef.current) map.getCanvas().style.cursor = "";
  };
  const onWaypointMouseDown = (e: maplibregl.MapLayerMouseEvent) => {
    if (e.originalEvent.button !== 0) return;
    const idx = Number((e.features?.[0]?.properties as { idx?: number } | undefined)?.idx);
    if (!Number.isFinite(idx) || idx < 1) return;
    refs.dragRef.current = { index: idx - 1, startX: e.point.x, startY: e.point.y, moved: false };
    map.dragPan.disable();
    map.getCanvas().style.cursor = "grabbing";
    e.preventDefault();
  };

  const onWaypointTouchStart = (e: maplibregl.MapLayerTouchEvent) => {
    if (e.points.length !== 1) return;
    const idx = Number((e.features?.[0]?.properties as { idx?: number } | undefined)?.idx);
    if (!Number.isFinite(idx) || idx < 1) return;
    refs.dragRef.current = { index: idx - 1, startX: e.point.x, startY: e.point.y, moved: false };
    map.dragPan.disable();
    e.preventDefault();
  };

  for (const layerId of interactiveLayers) {
    map.on("mouseenter", layerId, onLayerEnter);
    map.on("mouseleave", layerId, onLayerLeave);
  }
  map.on("mousedown", "v2-waypoints", onWaypointMouseDown);
  map.on("touchstart", "v2-waypoints", onWaypointTouchStart);

  const canDragRoute = () => !!refs.onRouteDragStartRef?.current && !refs.onRouteSelectRef.current;
  /** La tappa sotto il puntatore ha la precedenza sulla linea. */
  const overWaypoint = (point: { x: number; y: number }) =>
    !!map.getLayer("v2-waypoints") && map.queryRenderedFeatures([point.x, point.y], { layers: ["v2-waypoints"] }).length > 0;

  const onRouteMouseDown = (e: maplibregl.MapLayerMouseEvent) => {
    if (e.originalEvent.button !== 0 || !canDragRoute() || refs.dragRef.current) return;
    if (overWaypoint(e.point)) return;
    refs.dragRef.current = {
      index: -1,
      startX: e.point.x,
      startY: e.point.y,
      moved: false,
      fromRoute: { lng: e.lngLat.lng, lat: e.lngLat.lat },
    };
    map.dragPan.disable();
    map.getCanvas().style.cursor = "grabbing";
    e.preventDefault();
  };
  const onRouteTouchStart = (e: maplibregl.MapLayerTouchEvent) => {
    if (e.points.length !== 1 || !canDragRoute() || refs.dragRef.current) return;
    if (overWaypoint(e.point)) return;
    refs.dragRef.current = {
      index: -1,
      startX: e.point.x,
      startY: e.point.y,
      moved: false,
      fromRoute: { lng: e.lngLat.lng, lat: e.lngLat.lat },
    };
    map.dragPan.disable();
    e.preventDefault();
  };
  map.on("mousedown", "v2-route-hit", onRouteMouseDown);
  map.on("touchstart", "v2-route-hit", onRouteTouchStart);

  const onRouteEnter = () => {
    if (refs.dragRef.current) return;
    if (refs.onRouteSelectRef.current) map.getCanvas().style.cursor = "pointer";
    else if (canDragRoute()) map.getCanvas().style.cursor = "grab";
  };
  const onRouteLeave = () => {
    if (!refs.dragRef.current) map.getCanvas().style.cursor = "";
  };
  const onRouteClick = (e: maplibregl.MapLayerMouseEvent) => {
    if (!refs.onRouteSelectRef.current) return;
    const f = e.features?.[0];
    const routeId = (f?.properties as { routeId?: string } | undefined)?.routeId;
    if (routeId) {
      e.preventDefault();
      refs.onRouteSelectRef.current(routeId);
    }
  };
  map.on("mouseenter", "v2-route-hit", onRouteEnter);
  map.on("mouseleave", "v2-route-hit", onRouteLeave);
  map.on("click", "v2-route-hit", onRouteClick);

  return () => {
    for (const layerId of interactiveLayers) {
      map.off("mouseenter", layerId, onLayerEnter);
      map.off("mouseleave", layerId, onLayerLeave);
    }
    map.off("mousedown", "v2-waypoints", onWaypointMouseDown);
    map.off("touchstart", "v2-waypoints", onWaypointTouchStart);
    map.off("mousedown", "v2-route-hit", onRouteMouseDown);
    map.off("touchstart", "v2-route-hit", onRouteTouchStart);
    map.off("mouseenter", "v2-route-hit", onRouteEnter);
    map.off("mouseleave", "v2-route-hit", onRouteLeave);
    map.off("click", "v2-route-hit", onRouteClick);
  };
}

export function attachGlobalHandlers(map: MaplibreMap, refs: MapHandlerRefs): void {
  const onDragMove = (point: { x: number; y: number }, lngLat: { lng: number; lat: number }) => {
    const drag = refs.dragRef.current;
    if (!drag) return;
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 5) {
      if (drag.fromRoute) {
        // Primo movimento vero sulla linea: ora nasce la tappa, nel tratto afferrato.
        const idx = refs.onRouteDragStartRef?.current?.(drag.fromRoute.lng, drag.fromRoute.lat);
        if (idx == null) {
          refs.dragRef.current = null;
          map.dragPan.enable();
          map.getCanvas().style.cursor = "";
          return;
        }
        drag.index = idx;
      }
      drag.moved = true;
    }
    if (drag.moved) {
      refs.onWaypointMoveRef.current?.(drag.index, lngLat.lng, lngLat.lat);
    }
  };
  map.on("mousemove", (e) => onDragMove(e.point, e.lngLat));
  map.on("touchmove", (e) => {
    if (!refs.dragRef.current) return;
    e.preventDefault();
    onDragMove(e.point, e.lngLat);
  });

  /** Sopprime il click sintetico che segue mouseup/touchend su una tappa. */
  const suppressNextClick = () => {
    refs.suppressClickRef.current = true;
    window.setTimeout(() => {
      refs.suppressClickRef.current = false;
    }, 400);
  };

  const finishDrag = (lngLat: { lng: number; lat: number }) => {
    const drag = refs.dragRef.current;
    if (!drag) return;
    refs.dragRef.current = null;
    map.dragPan.enable();
    map.getCanvas().style.cursor = "";
    // Click semplice sulla linea (senza trascinare): lascia passare il click normale.
    if (drag.fromRoute && !drag.moved) return;
    suppressNextClick();
    if (drag.moved) {
      refs.onWaypointMoveRef.current?.(drag.index, lngLat.lng, lngLat.lat);
    } else {
      const wp = refs.waypointsRef.current[drag.index];
      if (wp) {
        refs.onInteractionRef.current({
          kind: "waypoint",
          index: drag.index,
          lng: wp.lng,
          lat: wp.lat,
        });
      }
    }
  };

  map.on("mouseup", (e) => finishDrag(e.lngLat));
  map.on("touchend", (e) => finishDrag(e.lngLat));
  map.on("touchcancel", (e) => finishDrag(e.lngLat));
  map.on("mouseout", (e) => {
    if (refs.dragRef.current) finishDrag(e.lngLat);
  });

  map.on("click", (e) => {
    if (refs.suppressClickRef.current) {
      refs.suppressClickRef.current = false;
      return;
    }
    // Click su una tappa: gestito da mousedown/mouseup (drag o selezione).
    if (map.getLayer("v2-waypoints") && map.queryRenderedFeatures(e.point, { layers: ["v2-waypoints"] }).length > 0) {
      return;
    }
    const outdoorHits =
      refs.allowOutdoorPickRef.current && map.getLayer("v2-outdoor-hit")
        ? map.queryRenderedFeatures(e.point, { layers: ["v2-outdoor-hit"] })
        : [];
    if (outdoorHits.length > 0) {
      const props = outdoorHits[0].properties as {
        id?: string;
        name?: string;
        kind?: string;
      };
      const coords = (outdoorHits[0].geometry as GeoJSON.Point).coordinates;
      if (props.id) {
        refs.onInteractionRef.current({
          kind: "feature",
          feature: {
            id: props.id,
            name: props.name ?? props.kind ?? "Elemento",
            kind: props.kind ?? "",
            lng: coords[0],
            lat: coords[1],
          },
        });
        return;
      }
    }

    const poiHits = map.getLayer("v2-pois-hit")
      ? map.queryRenderedFeatures(e.point, { layers: ["v2-pois-hit"] })
      : [];
    if (poiHits.length > 0) {
      const props = poiHits[0].properties as { id?: string };
      const poi = refs.poisRef.current.find((p) => p.id === props.id);
      if (poi) {
        refs.onInteractionRef.current({ kind: "poi", poi });
        return;
      }
    }

    if (refs.onRouteSelectRef.current && map.getLayer("v2-route-hit")) {
      const routeHits = map.queryRenderedFeatures(e.point, { layers: ["v2-route-hit"] });
      if (routeHits.length > 0) {
        const routeId = (routeHits[0].properties as { routeId?: string }).routeId;
        if (routeId) {
          refs.onRouteSelectRef.current(routeId);
          return;
        }
      }
    }

    if (refs.onReportSelectRef.current && map.getLayer("v2-reports-hit")) {
      const reportHits = map.queryRenderedFeatures(e.point, { layers: ["v2-reports-hit"] });
      if (reportHits.length > 0) {
        const reportId = (reportHits[0].properties as { reportId?: string }).reportId;
        if (reportId) {
          refs.onReportSelectRef.current(reportId);
          return;
        }
      }
    }

    if (refs.allowLabelPickRef?.current) {
      const place = pickBaseLabel(map, e.point);
      if (place) {
        refs.onInteractionRef.current({ kind: "place", place });
        return;
      }
    }

    refs.onInteractionRef.current({ kind: "map", lng: e.lngLat.lng, lat: e.lngLat.lat });
  });
}
