import type { UserRouteActivity } from "@/lib/sports";

export type FieldReportKind =
  | "avalanche"
  | "cornice"
  | "ice"
  | "snow_conditions"
  | "rockfall"
  | "road_closed"
  | "road_damaged"
  | "trail_decommissioned"
  | "trail_blocked"
  | "bridge_down"
  | "water"
  | "storm"
  | "ferrata_damage"
  | "livestock_dogs"
  | "steep"
  | "other";

export const FIELD_REPORT_KINDS: readonly FieldReportKind[] = [
  "avalanche",
  "cornice",
  "ice",
  "snow_conditions",
  "rockfall",
  "road_closed",
  "road_damaged",
  "trail_decommissioned",
  "trail_blocked",
  "bridge_down",
  "water",
  "storm",
  "ferrata_damage",
  "livestock_dogs",
  "steep",
  "other",
] as const;

/** SQLite CHECK list fragment */
export const FIELD_REPORT_KIND_CHECK_IN =
  "'avalanche','cornice','ice','snow_conditions','rockfall','road_closed','road_damaged','trail_decommissioned','trail_blocked','bridge_down','water','storm','ferrata_damage','livestock_dogs','steep','other'";

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
  severity: number;
  expires_at: number | null;
  photo_id: string | null;
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
  severity: number;
  expires_at: number | null;
  photo_id: string | null;
  created_at: number;
  updated_at: number;
};

export const REPORT_KIND_LABELS: Record<FieldReportKind, string> = {
  avalanche: "Valanga",
  cornice: "Cornice",
  ice: "Ghiaccio",
  snow_conditions: "Neve / manto",
  rockfall: "Caduta sassi",
  road_closed: "Strada chiusa",
  road_damaged: "Strada sconnessa",
  trail_decommissioned: "Sentiero dismesso",
  trail_blocked: "Sentiero bloccato",
  bridge_down: "Ponte caduto",
  water: "Acqua / guado",
  storm: "Temporale",
  ferrata_damage: "Ferrata danneggiata",
  livestock_dogs: "Cani da guardiania",
  steep: "Ripido",
  other: "Altro",
};

export const REPORT_KIND_COLORS: Record<FieldReportKind, string> = {
  avalanche: "#ef4444",
  cornice: "#dc2626",
  ice: "#38bdf8",
  snow_conditions: "#7dd3fc",
  rockfall: "#f97316",
  road_closed: "#f97316",
  road_damaged: "#ea580c",
  trail_decommissioned: "#64748b",
  trail_blocked: "#f43f5e",
  bridge_down: "#a855f7",
  water: "#3b82f6",
  storm: "#eab308",
  ferrata_damage: "#e879f9",
  livestock_dogs: "#84cc16",
  steep: "#eab308",
  other: "#94a3b8",
};

/** TTL in ms; null = no auto expiry (until resolved). */
export const REPORT_KIND_TTL_MS: Record<FieldReportKind, number | null> = {
  storm: 3 * 60 * 60 * 1000,
  avalanche: 72 * 60 * 60 * 1000,
  cornice: 48 * 60 * 60 * 1000,
  ice: 48 * 60 * 60 * 1000,
  snow_conditions: 48 * 60 * 60 * 1000,
  rockfall: 7 * 24 * 60 * 60 * 1000,
  road_closed: 30 * 24 * 60 * 60 * 1000,
  road_damaged: 14 * 24 * 60 * 60 * 1000,
  trail_decommissioned: null,
  trail_blocked: 14 * 24 * 60 * 60 * 1000,
  bridge_down: 30 * 24 * 60 * 60 * 1000,
  water: 7 * 24 * 60 * 60 * 1000,
  ferrata_damage: 30 * 24 * 60 * 60 * 1000,
  livestock_dogs: 7 * 24 * 60 * 60 * 1000,
  steep: 14 * 24 * 60 * 60 * 1000,
  other: 7 * 24 * 60 * 60 * 1000,
};

export const REPORT_KIND_SEVERITY: Record<FieldReportKind, number> = {
  avalanche: 3,
  storm: 3,
  rockfall: 3,
  bridge_down: 3,
  cornice: 2,
  ice: 2,
  trail_blocked: 2,
  ferrata_damage: 2,
  road_closed: 2,
  road_damaged: 2,
  trail_decommissioned: 2,
  snow_conditions: 1,
  water: 1,
  steep: 1,
  livestock_dogs: 1,
  other: 1,
};

/** Sport per cui la segnalazione è rilevante in mappa. */
export const REPORT_KIND_SPORTS: Record<FieldReportKind, UserRouteActivity[]> = {
  avalanche: ["ski", "snowshoe", "nordic", "hike", "trail_run"],
  cornice: ["ski", "snowshoe"],
  ice: ["ski", "snowshoe", "nordic", "hike", "trail_run", "ferrata"],
  snow_conditions: ["ski", "snowshoe", "nordic"],
  rockfall: ["hike", "trail_run", "ferrata", "mtb"],
  road_closed: ["road", "gravel", "mtb"],
  road_damaged: ["road", "gravel", "mtb"],
  trail_decommissioned: ["hike", "trail_run", "mtb", "ferrata"],
  trail_blocked: ["hike", "trail_run", "mtb", "ski", "snowshoe", "ferrata"],
  bridge_down: ["hike", "trail_run", "mtb", "road", "gravel"],
  water: ["hike", "trail_run", "mtb"],
  storm: ["hike", "trail_run", "ski", "snowshoe", "ferrata", "mtb", "road", "gravel"],
  ferrata_damage: ["ferrata"],
  livestock_dogs: ["hike", "trail_run", "mtb"],
  steep: ["hike", "trail_run", "mtb"],
  other: ["hike", "trail_run", "road", "gravel", "mtb", "ski", "snowshoe", "nordic", "ferrata"],
};

export function isFieldReportKind(raw: string): raw is FieldReportKind {
  return (FIELD_REPORT_KINDS as readonly string[]).includes(raw);
}

export function expiresAtForKind(kind: FieldReportKind, fromMs = Date.now()): number | null {
  const ttl = REPORT_KIND_TTL_MS[kind];
  if (ttl == null) return null;
  return fromMs + ttl;
}

export function renewExpiresAt(kind: FieldReportKind, fromMs = Date.now()): number | null {
  return expiresAtForKind(kind, fromMs);
}

export function isReportExpired(row: { expires_at: number | null; status: string }): boolean {
  if (row.status !== "active") return false;
  if (row.expires_at == null) return false;
  return row.expires_at < Date.now();
}

export function reportRelevantForSport(kind: FieldReportKind, sport: UserRouteActivity): boolean {
  return REPORT_KIND_SPORTS[kind].includes(sport);
}

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
    severity: row.severity,
    expires_at: row.expires_at,
    photo_id: row.photo_id,
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
        severity: r.severity,
        confirmationCount: r.confirmation_count,
        author: r.author,
        description: r.description,
      },
      geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] },
    })),
  };
}
