import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";

export function setGeoJson(map: MaplibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (src) src.setData(data);
}

/** Approximate circle polygon in WGS84 (good enough for 3 km radius). */
export function circlePolygon(lng: number, lat: number, radiusM: number, steps: number): [number, number][] {
  const coords: [number, number][] = [];
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(latRad);
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    coords.push([
      lng + (radiusM * Math.cos(angle)) / mPerDegLng,
      lat + (radiusM * Math.sin(angle)) / mPerDegLat,
    ]);
  }
  return coords;
}
