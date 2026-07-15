import fs from "node:fs";
import path from "node:path";
import { geoCacheGet, geoCacheSet } from "@/lib/db";
import { AVALANCHE_LEGEND } from "@/lib/ski-overlays";

const BULLETIN_URL =
  process.env.AVALANCHE_BULLETIN_URL?.trim() ||
  "https://api.avalanche.report/bulletin/caaml/v6/geojson?lang=it";

const CACHE_KEY = "ski:avalanche:bulletin:it:v1";

export type AvalancheMapFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  {
    regionId: string;
    regionName: string;
    danger: number | null;
    dangerLabel: string;
    elevation: string;
    threshold: number | null;
  }
>;

export type AvalancheMapPayload = {
  type: "FeatureCollection";
  features: AvalancheMapFeature[];
  meta: {
    publicationTime: string | null;
    validUntil: string | null;
    source: string;
    available: boolean;
    message: string | null;
  };
};

type EawsRegionProps = {
  id: string;
  elevation?: string;
  threshold?: number | null;
};

let regionsCache: GeoJSON.FeatureCollection | null = null;

function loadRegions(): GeoJSON.FeatureCollection {
  if (regionsCache) return regionsCache;
  const p = path.join(process.cwd(), "src/lib/data/eaws-regions-it.json");
  if (!fs.existsSync(p)) {
    return { type: "FeatureCollection", features: [] };
  }
  regionsCache = JSON.parse(fs.readFileSync(p, "utf8")) as GeoJSON.FeatureCollection;
  return regionsCache;
}

const DANGER_MAP: Record<string, number> = {
  low: 1,
  moderate: 2,
  considerable: 3,
  high: 4,
  very_high: 5,
  no_snow: 1,
  no_rating: 0,
};

function dangerFromValue(v: unknown): number | null {
  if (typeof v === "number" && v >= 1 && v <= 5) return v;
  if (typeof v === "string") {
    const n = DANGER_MAP[v.toLowerCase()];
    return n && n > 0 ? n : null;
  }
  return null;
}

function dangerLabel(level: number | null): string {
  if (level == null) return "N/D";
  return AVALANCHE_LEGEND.find((l) => l.level === level)?.label ?? String(level);
}

type CaamlFeature = GeoJSON.Feature & {
  properties?: Record<string, unknown>;
};

function extractRegionRatings(bulletin: GeoJSON.FeatureCollection): Map<string, { danger: number | null; name: string }> {
  const map = new Map<string, { danger: number | null; name: string }>();
  for (const feat of bulletin.features as CaamlFeature[]) {
    const props = feat.properties ?? {};
    const regions = (props.regions as { regionID?: string; name?: string }[] | undefined) ?? [];
    const ratings = (props.dangerRatings as { mainValue?: unknown; elevation?: { lowerBound?: string; upperBound?: string } }[] | undefined) ?? [];

    for (const region of regions) {
      const id = region.regionID?.trim();
      if (!id) continue;
      let best: number | null = null;
      for (const r of ratings) {
        const d = dangerFromValue(r.mainValue);
        if (d != null && (best == null || d > best)) best = d;
      }
      map.set(id, { danger: best, name: region.name ?? id });
    }

    const regionId = (props.regionID ?? props.regionId ?? props.id) as string | undefined;
    if (regionId) {
      let best: number | null = dangerFromValue(props.dangerRating ?? props.mainValue);
      for (const r of ratings) {
        const d = dangerFromValue(r.mainValue);
        if (d != null && (best == null || d > best)) best = d;
      }
      map.set(regionId, { danger: best, name: (props.name as string) ?? regionId });
    }
  }
  return map;
}

function extractMeta(bulletin: GeoJSON.FeatureCollection): {
  publicationTime: string | null;
  validUntil: string | null;
} {
  const feat = bulletin.features[0] as CaamlFeature | undefined;
  const props = feat?.properties ?? {};
  const pub = (props.publicationTime as string | undefined) ?? null;
  const valid = props.validTime as { endTime?: string } | undefined;
  return { publicationTime: pub, validUntil: valid?.endTime ?? null };
}

async function fetchBulletinRaw(): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const res = await fetch(BULLETIN_URL, {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": "hmr-companion/0.1",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    const j = JSON.parse(text) as GeoJSON.FeatureCollection;
    if (j.type !== "FeatureCollection" || !Array.isArray(j.features)) return null;
    return j;
  } catch {
    return null;
  }
}

export async function buildAvalancheMap(): Promise<AvalancheMapPayload> {
  const cached = geoCacheGet(CACHE_KEY) as AvalancheMapPayload | null;
  if (cached?.features) return cached;

  const regions = loadRegions();
  const bulletin = await fetchBulletinRaw();
  const ratings = bulletin ? extractRegionRatings(bulletin) : new Map();
  const metaTimes = bulletin ? extractMeta(bulletin) : { publicationTime: null, validUntil: null };

  const features: AvalancheMapFeature[] = regions.features.map((f) => {
    const props = (f.properties ?? {}) as EawsRegionProps;
    const regionId = String(props.id ?? "");
    const rating = ratings.get(regionId);
    const danger = rating?.danger ?? null;
    return {
      type: "Feature",
      properties: {
        regionId,
        regionName: rating?.name ?? regionId,
        danger,
        dangerLabel: dangerLabel(danger),
        elevation: props.elevation ?? "all",
        threshold: props.threshold ?? null,
      },
      geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    };
  });

  const available = bulletin != null && ratings.size > 0;
  const payload: AvalancheMapPayload = {
    type: "FeatureCollection",
    features,
    meta: {
      ...metaTimes,
      source: "AINEVA / avalanche.report (EAWS)",
      available,
      message: available
        ? null
        : "Bollettino non disponibile (stagione estiva o servizio non attivo). Le zone restano visibili senza grado di pericolo.",
    },
  };

  geoCacheSet(CACHE_KEY, payload);
  return payload;
}
