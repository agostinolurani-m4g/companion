/**
 * Costruzione di `meta_json` dai dettagli camptocamp (unica per sci e altre attività).
 * Funzioni pure: usate dagli import e dallo script di arricchimento.
 */
import { mercator3857ToWgs84, pickLocaleText, type C2cActivity, type C2cRouteDetail } from "@/lib/camptocamp";

export const C2C_SKI_KEYS = [
  "ski_rating",
  "ski_exposition",
  "labande_global_rating",
  "labande_ski_rating",
  "elevation_max",
  "elevation_min",
  "height_diff_up",
  "height_diff_down",
  "orientations",
] as const;

export const C2C_RATING_KEYS = [
  "global_rating",
  "hiking_rating",
  "hiking_mtb_exposition",
  "mtb_up_rating",
  "mtb_down_rating",
  "mtb_length_asphalt",
  "mtb_length_trail",
  "via_ferrata_rating",
  "snowshoe_rating",
  "engagement_rating",
  "risk_rating",
  "rock_free_rating",
  "orientations",
  "elevation_max",
  "elevation_min",
] as const;

/** Lunghezza massima salvata per la descrizione completa. */
export const C2C_DESCRIPTION_MAX = 6000;

/** Chiavi aggiunte da altri passaggi (backfill) da non perdere quando si riscrive il meta. */
const PRESERVED_KEYS = ["derived", "quality"] as const;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return `${cut.slice(0, lastBreak > max * 0.6 ? lastBreak + 1 : max).trimEnd()} …`;
}

function titleOf(locales: { lang: string; title: string }[] | undefined): string | null {
  if (!locales?.length) return null;
  return (locales.find((l) => l.lang === "it") ?? locales.find((l) => l.lang === "en") ?? locales[0])!.title ?? null;
}

function accessPoint(detail: C2cRouteDetail): { name: string | null; lng: number | null; lat: number | null; elevation: number | null } | null {
  const wps = detail.associations?.waypoints ?? [];
  const wp = wps.find((w) => w.waypoint_type === "access") ?? wps.find((w) => w.waypoint_type === "hut");
  if (!wp) return null;
  let lng: number | null = null;
  let lat: number | null = null;
  try {
    const g = wp.geometry?.geom ? (JSON.parse(wp.geometry.geom) as GeoJSON.Point) : null;
    if (g?.type === "Point" && g.coordinates.length >= 2) {
      const [x, y] = mercator3857ToWgs84(g.coordinates[0]!, g.coordinates[1]!);
      lng = Math.round(x * 1e6) / 1e6;
      lat = Math.round(y * 1e6) / 1e6;
    }
  } catch {
    /* geometria non valida */
  }
  return { name: titleOf(wp.locales), lng, lat, elevation: wp.elevation ?? null };
}

/** Meta completo per un percorso camptocamp (`act` = attività c2c usata nella ricerca). */
export function buildC2cMeta(detail: C2cRouteDetail, act: C2cActivity, now = Date.now()): Record<string, unknown> {
  const d = detail as unknown as Record<string, unknown>;
  const meta: Record<string, unknown> = {};
  if (act !== "skitouring") meta.c2c_activity = act;
  const keys = act === "skitouring" ? C2C_SKI_KEYS : C2C_RATING_KEYS;
  for (const k of keys) if (d[k] != null && d[k] !== "") meta[k] = d[k];

  const summary = pickLocaleText(detail.locales, "summary");
  meta.summary = summary?.text ?? null;
  if (summary) meta.summary_lang = summary.lang;
  const description = pickLocaleText(detail.locales, "description");
  if (description) {
    meta.description = truncate(description.text, C2C_DESCRIPTION_MAX);
    meta.description_lang = description.lang;
  }
  meta.langs = detail.locales.map((l) => l.lang);
  // Durata camptocamp: in giorni (anche per lo sci).
  if (Array.isArray(detail.durations) && detail.durations.length) meta.durations = detail.durations;
  if (typeof detail.calculated_duration === "number") meta.calculated_duration = detail.calculated_duration;
  if (detail.route_types?.length) meta.route_types = detail.route_types;
  if (detail.lift_access != null) meta.lift_access = detail.lift_access;
  if (detail.glacier_gear && detail.glacier_gear !== "no") meta.glacier_gear = detail.glacier_gear;
  const access = accessPoint(detail);
  if (access) meta.access = access;
  const areas = (detail.areas ?? []).map((a) => titleOf(a.locales)).filter((t): t is string => !!t);
  if (areas.length) meta.areas = areas;
  meta.enriched_at = now;
  return meta;
}

/** Unisce il meta nuovo con quello esistente conservando i fatti derivati dai backfill. */
export function mergeC2cMeta(old: Record<string, unknown> | null, fresh: Record<string, unknown>): Record<string, unknown> {
  const out = { ...fresh };
  if (old) {
    for (const k of PRESERVED_KEYS) if (old[k] != null && out[k] == null) out[k] = old[k];
    // Il dettaglio non ha `c2c_activity` per lo sci; mantieni quella dell'import se c'era.
    if (old.c2c_activity != null && out.c2c_activity == null) out.c2c_activity = old.c2c_activity;
  }
  return out;
}
