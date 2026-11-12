/**
 * geo.admin.ch — chiusure sentieri e zone fauna (Svizzera).
 * Layer hiking trail closure / quiet zones (semplificato via identify).
 */

export type GeoAdminFeature = {
  id: string;
  label: string;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
};

export async function fetchGeoAdminQuietZones(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<GeoAdminFeature[]> {
  const layer = "ch.are.alpenschutzflaechen";
  const url = `https://api3.geo.admin.ch/rest/services/all/MapServer/${layer}/query?geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&returnGeometry=true&f=geojson`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return [];
    const fc = (await res.json()) as GeoJSON.FeatureCollection;
    return (fc.features ?? []).map((f, i) => ({
      id: String(f.id ?? `ch-${i}`),
      label: String((f.properties as Record<string, unknown>)?.name ?? "Zona protetta"),
      geometry: f.geometry!,
      properties: (f.properties ?? {}) as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}
