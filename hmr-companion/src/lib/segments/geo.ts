import type { SegmentDto } from "./serialize";

/** Segmenti → FeatureCollection per il layer `v2-segments` della mappa. */
export function segmentsToGeoJson(segments: SegmentDto[], selectedId?: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: segments
      .filter((s) => s.geojson)
      .map((s) => ({
        type: "Feature",
        properties: { segmentId: s.id, name: s.name, selected: s.id === selectedId },
        geometry: s.geojson as GeoJSON.LineString,
      })),
  };
}

export function formatDuration(s: number | null | undefined): string {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 1 : 2)} km` : `${Math.round(m)} m`;
}
