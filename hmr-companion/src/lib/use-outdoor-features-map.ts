"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewBbox } from "@/lib/overpass";
import type { UserRouteActivity } from "@/lib/sports";
import type { OutdoorGroup } from "@/lib/outdoor/groups";
import { fetchJson } from "@/lib/fetch-json";

export type OutdoorGroupCount = { grp: string; n: number };

const MIN_ZOOM = 12;
const DEBOUNCE_MS = 700;

export function useOutdoorFeaturesOnMap(
  viewport: ViewBbox | null,
  zoom: number,
  sport: UserRouteActivity | undefined,
  enabledGroups: OutdoorGroup[] | null,
  enabled = true,
) {
  const [featuresGeoJson, setFeaturesGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [groupCounts, setGroupCounts] = useState<OutdoorGroupCount[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (bbox: ViewBbox) => {
      setBusy(true);
      try {
        const params = new URLSearchParams({
          south: String(bbox.south),
          west: String(bbox.west),
          north: String(bbox.north),
          east: String(bbox.east),
          zoom: String(Math.round(zoom)),
        });
        if (sport) params.set("sport", sport);
        if (enabledGroups && enabledGroups.length > 0) {
          params.set("groups", enabledGroups.join(","));
        }
        params.set("fill", "0");
        const data = await fetchJson<{
          geojson: GeoJSON.FeatureCollection;
          counts: OutdoorGroupCount[];
        }>(`/api/v2/features?${params}`);
        setFeaturesGeoJson(data.geojson);
        setGroupCounts(data.counts ?? []);
      } catch {
        setFeaturesGeoJson(null);
      } finally {
        setBusy(false);
      }
    },
    [zoom, sport, enabledGroups],
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !viewport || zoom < MIN_ZOOM) {
      setFeaturesGeoJson(null);
      setGroupCounts([]);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void refresh(viewport);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [viewport, refresh, enabled, zoom]);

  return { featuresGeoJson, groupCounts, busy, refresh };
}
