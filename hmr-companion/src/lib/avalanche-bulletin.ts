import fs from "node:fs";
import path from "node:path";
import { getConditionsCache, setConditionsCache } from "@/lib/db";
import {
  bulletinCacheTtlMs,
  bulletinDangerLabel,
  checkRouteAspects,
  dangerForElevationBand,
  dangerLabel,
  parseCaamlBulletins,
  pointInGeometry,
  selectRegionBulletins,
  type AspectCheck,
  type RegionBulletin,
} from "@/lib/avalanche-caaml";

/**
 * Bollettini valanghe EAWS (CAAML v6 JSON) dai file statici pubblicati da avalanche.report
 * per ciascun servizio regionale: `{base}/{data}/{data}-{fornitore}[.it].json`.
 * Verificato con richieste reali (es. 2026-02-15-IT-25.it.json = AINEVA Lombardia).
 */
const STATIC_BASE =
  process.env.AVALANCHE_STATIC_BASE?.trim().replace(/\/$/, "") ||
  "https://static.avalanche.report/eaws_bulletins";

const CACHE_KEY = "ski:avalanche:eaws:v2";

export type AvalancheProvider = { id: string; label: string; italian: boolean };

/** Fornitori con poligoni locali (`eaws-regions-it.json`, `eaws-regions-ch-fr.json`). */
export const AVALANCHE_PROVIDERS: AvalancheProvider[] = [
  { id: "IT-21", label: "Piemonte", italian: true },
  { id: "IT-23", label: "Valle d'Aosta", italian: true },
  { id: "IT-25", label: "Lombardia", italian: true },
  { id: "IT-32-BZ", label: "Alto Adige", italian: true },
  { id: "IT-32-TN", label: "Trentino", italian: true },
  { id: "IT-34", label: "Veneto", italian: true },
  { id: "IT-36", label: "Friuli Venezia Giulia", italian: true },
  { id: "IT-57", label: "Marche", italian: true },
  { id: "IT-MeteoMont", label: "Appennino (Meteomont)", italian: false },
  { id: "CH", label: "Svizzera (SLF)", italian: true },
  { id: "FR", label: "Francia (Météo-France)", italian: false },
];

export function providerForRegion(regionId: string): AvalancheProvider | null {
  let best: AvalancheProvider | null = null;
  for (const p of AVALANCHE_PROVIDERS) {
    if ((regionId === p.id || regionId.startsWith(`${p.id}-`)) && (!best || p.id.length > best.id.length)) best = p;
  }
  return best;
}

export type AvalancheMapFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  {
    regionId: string;
    regionName: string;
    danger: number | null;
    dangerLabel: string;
    elevation: string;
    threshold: number | null;
    hasBulletin: boolean;
    provider: string | null;
  }
>;

export type ProviderCoverage = {
  providerId: string;
  label: string;
  status: "current" | "next_only" | "none" | "error";
  providerName: string | null;
  website: string | null;
  publicationTime: string | null;
  validFrom: string | null;
  validUntil: string | null;
  regions: number;
};

export type AvalancheMapPayload = {
  type: "FeatureCollection";
  features: AvalancheMapFeature[];
  meta: {
    /** Pubblicazione più recente tra i bollettini in vigore. */
    publicationTime: string | null;
    validFrom: string | null;
    /** Prima scadenza tra i bollettini in vigore. */
    validUntil: string | null;
    source: string;
    available: boolean;
    message: string | null;
    fetchedAt: number;
    coverage: ProviderCoverage[];
  };
};

type CachedFiles = {
  fetchedAt: number;
  files: { providerId: string; date: string; json: unknown }[];
  errors: string[];
};

type RegionFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>> & {
  _bbox: [number, number, number, number];
};

let regionsCache: { day: string; features: RegionFeature[] } | null = null;

function bboxOf(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number, number, number] {
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of polys)
    for (const ring of p)
      for (const [x, y] of ring) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
  return [w, s, e, n];
}

function loadRegionFile(name: string): GeoJSON.Feature[] {
  const p = path.join(process.cwd(), "src/lib/data", name);
  if (!fs.existsSync(p)) return [];
  const j = JSON.parse(fs.readFileSync(p, "utf8")) as GeoJSON.FeatureCollection;
  return j.features ?? [];
}

/** Poligoni EAWS attivi oggi (scarta versioni storiche con `end_date` passata). */
function loadRegions(today: string): RegionFeature[] {
  if (regionsCache?.day === today) return regionsCache.features;
  const all = [...loadRegionFile("eaws-regions-it.json"), ...loadRegionFile("eaws-regions-ch-fr.json")];
  const features: RegionFeature[] = [];
  for (const f of all) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const end = typeof props.end_date === "string" ? props.end_date : null;
    const start = typeof props.start_date === "string" ? props.start_date : null;
    if (end && end <= today) continue;
    if (start && start > today) continue;
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    features.push({ ...(f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>), _bbox: bboxOf(g) });
  }
  regionsCache = { day: today, features };
  return features;
}

/** Data YYYY-MM-DD nel fuso delle Alpi (Europe/Rome). */
export function alpineDate(t: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

/** Micro-regione EAWS che contiene il punto (o null se fuori copertura). */
export function findEawsRegion(lat: number, lng: number, now = Date.now()): { id: string; elevation: string | null } | null {
  for (const f of loadRegions(alpineDate(now))) {
    const [w, s, e, n] = f._bbox;
    if (lng < w || lng > e || lat < s || lat > n) continue;
    if (pointInGeometry(lng, lat, f.geometry)) {
      return { id: String(f.properties.id ?? ""), elevation: (f.properties.elevation as string | undefined) ?? null };
    }
  }
  return null;
}

async function fetchProviderFile(providerId: string, date: string, italian: boolean): Promise<unknown | null | "error"> {
  const suffixes = italian ? [".it.json", ".json"] : [".json"];
  for (const suf of suffixes) {
    try {
      const res = await fetch(`${STATIC_BASE}/${date}/${date}-${providerId}${suf}`, {
        headers: { Accept: "application/json", "User-Agent": "hmr-companion/0.1" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) continue;
      if (!res.ok) return "error";
      const text = await res.text();
      if (!text.trim()) continue;
      return JSON.parse(text) as unknown;
    } catch {
      return "error";
    }
  }
  return null;
}

let parsedMemo: { fetchedAt: number; bulletins: RegionBulletin[] } | null = null;

async function loadBulletinFiles(now: number): Promise<{ cached: CachedFiles; bulletins: RegionBulletin[] }> {
  const raw = getConditionsCache(CACHE_KEY);
  if (raw) {
    try {
      const cached = JSON.parse(raw) as CachedFiles;
      if (parsedMemo?.fetchedAt !== cached.fetchedAt) {
        parsedMemo = { fetchedAt: cached.fetchedAt, bulletins: cached.files.flatMap((f) => parseCaamlBulletins(f.json)) };
      }
      return { cached, bulletins: parsedMemo.bulletins };
    } catch {
      /* cache corrotta: riscarica */
    }
  }

  const today = alpineDate(now);
  const tomorrow = alpineDate(now + 24 * 3600_000);
  const jobs = AVALANCHE_PROVIDERS.flatMap((p) =>
    [today, tomorrow].map(async (date) => ({ providerId: p.id, date, json: await fetchProviderFile(p.id, date, p.italian) })),
  );
  const results = await Promise.all(jobs);
  const files: CachedFiles["files"] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.json === "error") errors.push(`${r.providerId}@${r.date}`);
    else if (r.json != null) files.push({ providerId: r.providerId, date: r.date, json: r.json });
  }
  const cached: CachedFiles = { fetchedAt: now, files, errors };
  const bulletins = files.flatMap((f) => parseCaamlBulletins(f.json));
  const { current } = selectRegionBulletins(bulletins, now);
  let ttl = bulletinCacheTtlMs(
    [...current.values()].map((b) => b.validUntil),
    now,
  );
  if (errors.length) ttl = Math.min(ttl, 15 * 60_000);
  setConditionsCache(CACHE_KEY, JSON.stringify(cached), ttl);
  parsedMemo = { fetchedAt: now, bulletins };
  return { cached, bulletins };
}

function coverageFor(
  current: Map<string, RegionBulletin>,
  next: Map<string, RegionBulletin>,
  errors: string[],
): ProviderCoverage[] {
  return AVALANCHE_PROVIDERS.map((p) => {
    const cur = [...current.values()].filter((b) => providerForRegion(b.regionId)?.id === p.id);
    const nxt = [...next.values()].filter((b) => providerForRegion(b.regionId)?.id === p.id);
    const ref = cur[0] ?? nxt[0] ?? null;
    const hadError = errors.some((e) => e.startsWith(`${p.id}@`));
    return {
      providerId: p.id,
      label: p.label,
      status: cur.length ? "current" : nxt.length ? "next_only" : hadError ? "error" : "none",
      providerName: ref?.provider.name ?? null,
      website: ref?.provider.website ?? null,
      publicationTime: ref?.publicationTime ?? null,
      validFrom: ref?.validFrom ?? null,
      validUntil: ref?.validUntil ?? null,
      regions: cur.length,
    };
  });
}

const NO_BULLETIN_MSG =
  "Nessun bollettino valanghe in vigore per le zone coperte (fuori stagione o non ancora emesso). Zona senza grado ≠ zona sicura.";

export async function buildAvalancheMap(now = Date.now()): Promise<AvalancheMapPayload> {
  const { cached, bulletins } = await loadBulletinFiles(now);
  const { current, next } = selectRegionBulletins(bulletins, now);
  const regions = loadRegions(alpineDate(now));

  const features: AvalancheMapFeature[] = regions.map((f) => {
    const props = f.properties;
    const regionId = String(props.id ?? "");
    const b = current.get(regionId) ?? null;
    const elevation = typeof props.elevation === "string" ? props.elevation : "all";
    const danger = b ? dangerForElevationBand(b, elevation) : null;
    return {
      type: "Feature",
      properties: {
        regionId,
        regionName: b?.regionName ?? regionId,
        danger,
        dangerLabel: !b ? "Nessun bollettino" : danger != null ? dangerLabel(danger) : bulletinDangerLabel(b),
        elevation,
        threshold: typeof props.threshold === "number" ? props.threshold : null,
        hasBulletin: b != null,
        provider: b?.provider.name ?? null,
      },
      geometry: f.geometry,
    };
  });

  // «Disponibile» solo se almeno un bollettino in vigore assegna un grado (no_snow/no_rating esclusi).
  const graded = [...current.values()].filter((b) => b.maxDanger != null);
  const cur = graded.length ? graded : [...current.values()];
  const pubs = cur.map((b) => b.publicationTime).filter((x): x is string => !!x).sort();
  const untils = cur.map((b) => b.validUntil).filter((x): x is string => !!x).sort();
  const froms = cur.map((b) => b.validFrom).filter((x): x is string => !!x).sort();
  const available = graded.length > 0;
  const providers = [...new Set(cur.map((b) => b.provider.name))];

  return {
    type: "FeatureCollection",
    features,
    meta: {
      publicationTime: pubs.at(-1) ?? null,
      validFrom: froms[0] ?? null,
      validUntil: untils[0] ?? null,
      source: providers.length ? `${providers.join(", ")} via EAWS / avalanche.report` : "EAWS / avalanche.report",
      available,
      message: available ? null : NO_BULLETIN_MSG,
      fetchedAt: cached.fetchedAt,
      coverage: coverageFor(current, next, cached.errors),
    },
  };
}

export type AvalanchePointPayload = {
  status: "ok" | "no_bulletin" | "outside_coverage";
  message: string | null;
  region: { id: string; name: string; provider: string | null } | null;
  bulletin: RegionBulletin | null;
  next: Pick<RegionBulletin, "maxDanger" | "publicationTime" | "validFrom" | "validUntil"> | null;
  aspectCheck: AspectCheck;
  fetchedAt: number;
};

export async function avalancheForPoint(
  lat: number,
  lng: number,
  opts: { orientations?: string[]; minEle?: number | null; maxEle?: number | null } = {},
  now = Date.now(),
): Promise<AvalanchePointPayload> {
  const region = findEawsRegion(lat, lng, now);
  const { cached, bulletins } = await loadBulletinFiles(now);
  const elev = opts.minEle != null || opts.maxEle != null ? { minEle: opts.minEle, maxEle: opts.maxEle } : null;

  if (!region) {
    return {
      status: "outside_coverage",
      message: "Nessun bollettino disponibile per questa zona: il punto è fuori dalle aree coperte dai servizi valanghe collegati.",
      region: null,
      bulletin: null,
      next: null,
      aspectCheck: checkRouteAspects(opts.orientations, null, elev),
      fetchedAt: cached.fetchedAt,
    };
  }
  const { current, next } = selectRegionBulletins(bulletins, now);
  const b = current.get(region.id) ?? null;
  const n = next.get(region.id) ?? null;
  const prov = providerForRegion(region.id);
  return {
    status: b ? "ok" : "no_bulletin",
    message: b
      ? null
      : `Nessun bollettino disponibile per questa zona oggi (${prov?.label ?? region.id}: fuori stagione o non ancora emesso).`,
    region: { id: region.id, name: b?.regionName ?? n?.regionName ?? region.id, provider: (b ?? n)?.provider.name ?? prov?.label ?? null },
    bulletin: b,
    next: n ? { maxDanger: n.maxDanger, publicationTime: n.publicationTime, validFrom: n.validFrom, validUntil: n.validUntil } : null,
    aspectCheck: checkRouteAspects(opts.orientations, b, elev),
    fetchedAt: cached.fetchedAt,
  };
}
