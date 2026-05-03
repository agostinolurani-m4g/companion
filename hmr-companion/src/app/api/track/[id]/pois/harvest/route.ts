import { NextResponse } from "next/server";
import { CATEGORY_ORDER } from "@/lib/categories";
import { requireAuthenticated } from "@/lib/auth";
import type { PoiCategory } from "@/lib/db";
import { geoCacheGet, geoCacheSet, getDb, getTrack } from "@/lib/db";
import { insertOsmNodesForTrack } from "@/lib/poi-osm-insert";
import type { OsmNode } from "@/lib/overpass";
import {
  bboxKeysForPoiCategories,
  clampPoiHarvestRadiusM,
  fetchPoiTypesAround,
  OverpassError,
} from "@/lib/overpass";
import type { StoredCoord } from "@/lib/track-coords";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const VALID_CATEGORY = new Set<string>(CATEGORY_ORDER);

type Body = {
  lat?: number;
  lng?: number;
  /** Raggio ricerca OSM attorno al clic (m), default 1800, max 5000. */
  radiusM?: number;
  /** Se true, ignora cache Overpass e riscarica (default false). */
  refresh?: boolean;
  /** Sottoinsiemi di `PoiCategory`: solo queste vengono cercate (Overpass) e importate. */
  categories?: string[];
};

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id: trackId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) {
    return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const lat = body.lat;
  const lng = body.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Serve lat e lng numerici" }, { status: 400 });
  }
  const radiusM =
    typeof body.radiusM === "number" && Number.isFinite(body.radiusM)
      ? body.radiusM
      : 1800;
  const refresh = body.refresh === true;

  let filterCategories: PoiCategory[] | null = null;
  if (Array.isArray(body.categories) && body.categories.length > 0) {
    const parsed = body.categories.filter((c): c is PoiCategory =>
      typeof c === "string" && VALID_CATEGORY.has(c)
    );
    if (parsed.length > 0) filterCategories = parsed;
  }

  const bboxKeys = filterCategories ? bboxKeysForPoiCategories(filterCategories) : null;
  const rEff = clampPoiHarvestRadiusM(radiusM);
  const catKey =
    bboxKeys && bboxKeys.length > 0 ? [...bboxKeys].sort().join("-") : "all";
  const overpassCacheKey = `harvest:${Math.round(lat * 1e4)}_${Math.round(lng * 1e4)}_${rEff}_${catKey}`;

  let nodes: OsmNode[];
  let fromOverpassCache = false;
  if (!refresh) {
    const cached = geoCacheGet(overpassCacheKey);
    if (cached != null && Array.isArray(cached)) {
      nodes = cached as OsmNode[];
      fromOverpassCache = true;
    } else {
      try {
        nodes = await fetchPoiTypesAround(lat, lng, radiusM, bboxKeys);
      } catch (e) {
        const msg = e instanceof OverpassError ? e.message : (e as Error).message;
        const status = e instanceof OverpassError && e.transient ? 503 : 502;
        return NextResponse.json({ error: `Overpass: ${msg}` }, { status });
      }
      geoCacheSet(overpassCacheKey, nodes);
    }
  } else {
    try {
      nodes = await fetchPoiTypesAround(lat, lng, radiusM, bboxKeys);
    } catch (e) {
      const msg = e instanceof OverpassError ? e.message : (e as Error).message;
      const status = e instanceof OverpassError && e.transient ? 503 : 502;
      return NextResponse.json({ error: `Overpass: ${msg}` }, { status });
    }
    geoCacheSet(overpassCacheKey, nodes);
  }

  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  const db = getDb();
  const { inserted, skippedDetour, skippedUnclassified, skippedCategoryFilter, pois } =
    insertOsmNodesForTrack(db, trackId, coords, nodes, {
      allowedCategories: filterCategories ?? undefined,
      relaxedDetourForHarvest: true,
    });

  return NextResponse.json({
    ok: true,
    osmReturned: nodes.length,
    inserted,
    skippedDetour,
    skippedUnclassified,
    skippedCategoryFilter,
    pois,
    fromOverpassCache,
  });
}
