"use client";

import { useCallback, useEffect, useState } from "react";
import type { ViewBbox } from "@/lib/overpass";
import type { FieldReportDto, FieldReportKind } from "@/lib/field-reports";
import { fetchJson } from "@/lib/fetch-json";

export function useFieldReportsOnMap(viewport: ViewBbox | null) {
  const [reportsGeoJson, setReportsGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [reports, setReports] = useState<FieldReportDto[]>([]);

  const refresh = useCallback(async (bbox: ViewBbox) => {
    const q = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
    const data = await fetchJson<{ reports: FieldReportDto[]; geojson: GeoJSON.FeatureCollection }>(
      `/api/v2/reports?bbox=${q}`,
    );
    setReports(data.reports);
    setReportsGeoJson(data.geojson);
  }, []);

  useEffect(() => {
    if (!viewport) return;
    void refresh(viewport).catch(() => {
      setReports([]);
      setReportsGeoJson(null);
    });
  }, [viewport, refresh]);

  return { reports, reportsGeoJson, refresh };
}
