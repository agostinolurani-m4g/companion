import { NextResponse } from "next/server";
import type { Position } from "geojson";
import {
  getOsmOverpassCachePayload,
  getOsmOverpassCachePayloadAllowStale,
  osmPathQueryCacheKey,
  pruneExpiredOsmOverpassCache,
  setOsmOverpassCachePayload,
} from "@/lib/db";
import { bboxFromPositions, fetchDrinkingWaterAlongCorridor } from "@/lib/overpass";
import { samplePointsAlongPolyline } from "@/lib/track-geometry";

export const runtime = "nodejs";

const SPACING_KM = 2.5;
const MAX_SAMPLES = 18;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      coordinates?: Position[];
      radiusMeters?: number;
    };
    const coords = body.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      return NextResponse.json(
        { error: "coordinates (almeno 2 punti del percorso) richiesto" },
        { status: 400 }
      );
    }
    const radiusM =
      typeof body.radiusMeters === "number" && body.radiusMeters > 0 && body.radiusMeters <= 2000
        ? Math.floor(body.radiusMeters)
        : 450;

    const sampled = samplePointsAlongPolyline(coords, SPACING_KM, MAX_SAMPLES);
    if (sampled.length === 0) {
      return NextResponse.json({ error: "percorso non valido" }, { status: 400 });
    }

    const cacheKey = osmPathQueryCacheKey("water", sampled, radiusM);
    const hit = getOsmOverpassCachePayload(cacheKey);
    if (hit) {
      if (Math.random() < 0.05) pruneExpiredOsmOverpassCache();
      const parsed = JSON.parse(hit) as { pois: unknown };
      return NextResponse.json({ pois: parsed.pois, cached: true, stale: false, mode: "corridor" });
    }
    try {
      const pois = await fetchDrinkingWaterAlongCorridor(sampled, radiusM, 55);
      const bbox = bboxFromPositions(sampled);
      setOsmOverpassCachePayload(
        cacheKey,
        "water",
        bbox.south,
        bbox.west,
        bbox.north,
        bbox.east,
        JSON.stringify({ pois })
      );
      return NextResponse.json({ pois, cached: false, stale: false, mode: "corridor" });
    } catch (err) {
      const staleRow = getOsmOverpassCachePayloadAllowStale(cacheKey);
      if (staleRow) {
        const parsed = JSON.parse(staleRow.payload_json) as { pois: unknown };
        return NextResponse.json({
          pois: parsed.pois,
          cached: true,
          stale: staleRow.stale,
          warning: err instanceof Error ? err.message : "Overpass non disponibile",
          mode: "corridor",
        });
      }
      throw err;
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Overpass non disponibile" },
      { status: 500 }
    );
  }
}
