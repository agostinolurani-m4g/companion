import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { CATEGORY_ORDER } from "@/lib/categories";
import type { PoiCategory } from "@/lib/db";
import { geoCacheGet, geoCacheSet } from "@/lib/db";
import {
  bboxKeysForPoiCategories,
  clampPoiHarvestRadiusM,
  classifyOsm,
  fetchPoiTypesAround,
  osmDescriptionFromTags,
  osmImageFromTags,
  osmOpeningHoursFromTags,
  osmPhoneFromTags,
  osmWebsiteFromTags,
  OverpassError,
} from "@/lib/overpass";

export const runtime = "nodejs";

const VALID_CATEGORY = new Set<string>(CATEGORY_ORDER);

type Body = {
  lat?: number;
  lng?: number;
  radiusM?: number;
  refresh?: boolean;
  categories?: string[];
};

export type V2SearchPoi = {
  id: string;
  name: string | null;
  category: PoiCategory;
  sub_kind: string;
  lat: number;
  lng: number;
  image?: string | null;
  description?: string | null;
  phone?: string | null;
  website?: string | null;
  opening_hours?: string | null;
  wikidata?: string | null;
  wikipedia?: string | null;
};

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const lat = body.lat;
  const lng = body.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Serve lat e lng numerici" }, { status: 400 });
  }

  const radiusM =
    typeof body.radiusM === "number" && Number.isFinite(body.radiusM) ? body.radiusM : 2500;
  const refresh = body.refresh === true;

  let filterCategories: PoiCategory[] | null = null;
  if (Array.isArray(body.categories) && body.categories.length > 0) {
    const parsed = body.categories.filter(
      (c): c is PoiCategory => typeof c === "string" && VALID_CATEGORY.has(c)
    );
    if (parsed.length > 0) filterCategories = parsed;
  }

  const bboxKeys = filterCategories ? bboxKeysForPoiCategories(filterCategories) : null;
  const rEff = clampPoiHarvestRadiusM(radiusM);
  const catKey = bboxKeys && bboxKeys.length > 0 ? [...bboxKeys].sort().join("-") : "all";
  const cacheKey = `v2poi:${Math.round(lat * 1e4)}_${Math.round(lng * 1e4)}_${rEff}_${catKey}`;

  let nodes;
  let fromCache = false;
  if (!refresh) {
    const cached = geoCacheGet(cacheKey);
    if (cached != null && Array.isArray(cached)) {
      nodes = cached;
      fromCache = true;
    }
  }

  if (!nodes) {
    try {
      nodes = await fetchPoiTypesAround(lat, lng, radiusM, bboxKeys);
      geoCacheSet(cacheKey, nodes);
    } catch (e) {
      const msg = e instanceof OverpassError ? e.message : (e as Error).message;
      const status = e instanceof OverpassError && e.transient ? 503 : 502;
      return NextResponse.json({ error: `Overpass: ${msg}` }, { status });
    }
  }

  const pois: V2SearchPoi[] = [];
  for (const n of nodes) {
    if (n.lat == null || n.lon == null) continue;
    const tags = n.tags ?? {};
    const klass = classifyOsm(tags);
    if (!klass) continue;
    if (filterCategories && !filterCategories.includes(klass.category)) continue;
    pois.push({
      id: `${n.type}:${n.id}`,
      name: tags.name ?? tags["name:en"] ?? tags["name:el"] ?? null,
      category: klass.category,
      sub_kind: klass.sub_kind,
      lat: n.lat,
      lng: n.lon,
      image: osmImageFromTags(tags),
      description: osmDescriptionFromTags(tags),
      phone: osmPhoneFromTags(tags),
      website: osmWebsiteFromTags(tags),
      opening_hours: osmOpeningHoursFromTags(tags),
      wikidata: tags.wikidata?.trim() || null,
      wikipedia: tags.wikipedia?.trim() || tags["wikipedia:en"]?.trim() || tags["wikipedia:it"]?.trim() || null,
    });
  }

  return NextResponse.json({ ok: true, pois, fromCache, count: pois.length });
}
