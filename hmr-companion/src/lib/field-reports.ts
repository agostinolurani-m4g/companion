export type FieldReportKind =
  | "avalanche"
  | "road_closed"
  | "steep"
  | "bridge_down"
  | "trail_blocked"
  | "water"
  | "other";

export type FieldReportDto = {
  id: string;
  author: string;
  lng: number;
  lat: number;
  kind: FieldReportKind;
  kind_label: string;
  description: string;
  route_id: string | null;
  status: string;
  confirmation_count: number;
  verified: boolean;
  created_at: number;
  updated_at: number;
  viewer_confirmed?: boolean;
};

export type FieldReportRowInput = {
  id: string;
  author: string;
  lng: number;
  lat: number;
  kind: FieldReportKind;
  description: string;
  route_id: string | null;
  status: string;
  confirmation_count: number;
  created_at: number;
  updated_at: number;
};

export const REPORT_KIND_LABELS: Record<FieldReportKind, string> = {
  avalanche: "Valanga",
  road_closed: "Strada chiusa",
  steep: "Ripido",
  bridge_down: "Ponte caduto",
  trail_blocked: "Sentiero bloccato",
  water: "Acqua / guado",
  other: "Altro",
};

export const REPORT_KIND_COLORS: Record<FieldReportKind, string> = {
  avalanche: "#ef4444",
  road_closed: "#f97316",
  steep: "#eab308",
  bridge_down: "#a855f7",
  trail_blocked: "#f43f5e",
  water: "#3b82f6",
  other: "#94a3b8",
};

export function serializeFieldReport(
  row: FieldReportRowInput,
  extras?: { viewer_confirmed?: boolean },
): FieldReportDto {
  return {
    id: row.id,
    author: row.author,
    lng: row.lng,
    lat: row.lat,
    kind: row.kind,
    kind_label: REPORT_KIND_LABELS[row.kind],
    description: row.description,
    route_id: row.route_id,
    status: row.status,
    confirmation_count: row.confirmation_count,
    verified: row.status === "active" && row.confirmation_count >= 2,
    created_at: row.created_at,
    updated_at: row.updated_at,
    viewer_confirmed: extras?.viewer_confirmed,
  };
}

export function fieldReportsToGeoJson(
  reports: FieldReportDto[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: reports.map((r) => ({
      type: "Feature" as const,
      properties: {
        reportId: r.id,
        kind: r.kind,
        kindLabel: r.kind_label,
        color: REPORT_KIND_COLORS[r.kind],
        verified: r.verified,
        confirmationCount: r.confirmation_count,
        author: r.author,
        description: r.description,
      },
      geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] },
    })),
  };
}
