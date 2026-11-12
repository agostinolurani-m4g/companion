import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { OutdoorFeatureRow } from "./store";
import { kindMeta } from "./kinds";
import { trailLineColor } from "./trail-style";

export type OutdoorFeatureProperties = {
  id: string;
  kind: string;
  grp: string;
  name: string;
  ele: number | null;
  color: string;
  lineColor?: string;
  dashed?: boolean;
};

export function outdoorFeaturesToGeoJson(rows: OutdoorFeatureRow[]): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    const meta = kindMeta(row.kind);
    const color = meta?.color ?? "#64748b";
    const tags = JSON.parse(row.tags_json) as Record<string, string>;
    const props: OutdoorFeatureProperties = {
      id: row.id,
      kind: row.kind,
      grp: row.grp,
      name: row.name,
      ele: row.ele,
      color,
      lineColor: trailLineColor(tags, row.kind),
      dashed: row.kind.startsWith("trail_abandoned") || row.kind.startsWith("trail_disused") || row.kind === "access_no",
    };

    if (row.geom_json) {
      try {
        const geom = JSON.parse(row.geom_json) as LineString;
        features.push({ type: "Feature", geometry: geom, properties: props });
      } catch {
        features.push(pointFeature(row.lng, row.lat, props));
      }
    } else {
      features.push(pointFeature(row.lng, row.lat, props));
    }
  }
  return { type: "FeatureCollection", features };
}

function pointFeature(lng: number, lat: number, props: OutdoorFeatureProperties): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: props,
  };
}
