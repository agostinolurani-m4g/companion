import { NextResponse } from "next/server";
import type { Position } from "geojson";
import {
  getOsmOverpassCachePayload,
  getOsmOverpassCachePayloadAllowStale,
  osmOverpassCacheKey,
  osmPathQueryCacheKey,
  pruneExpiredOsmOverpassCache,
  setOsmOverpassCachePayload,
} from "@/lib/db";
import {
  bboxFromPositions,
  fetchTrailServicesAlongCorridor,
  fetchTrailServicesInBbox,
  padBbox,
} from "@/lib/overpass";
import { samplePointsAlongPolyline } from "@/lib/track-geometry";

export const runtime = "nodejs";

const SPACING_KM = 2.5;
const MAX_SAMPLES = 18;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      coordinates?: Position[];
      radiusMeters?: number;
      south?: number;
      west?: number;
      north?: number;
      east?: number;
    };

    const radiusM =
      typeof body.radiusMeters === "number" && body.radiusMeters > 0 && body.radiusMeters <= 2000
        ? Math.floor(body.radiusMeters)
        : 500;

    if (body.coordinates && Array.isArray(body.coordinates) && body.coordinates.length >= 2) {
      const sampled = samplePointsAlongPolyline(body.coordinates, SPACING_KM, MAX_SAMPLES);
      if (sampled.length === 0) {
        return NextResponse.json({ error: "percorso non valido" }, { status: 400 });
      }
      const cacheKey = osmPathQueryCacheKey("services", sampled, radiusM);
      const hit = getOsmOverpassCachePayload(cacheKey);
      if (hit) {
        if (Math.random() < 0.05) pruneExpiredOsmOverpassCache();
        const parsed = JSON.parse(hit) as { pois: unknown };
        return NextResponse.json({ pois: parsed.pois, cached: true, stale: false, mode: "corridor" });
      }
      try {
        const pois = await fetchTrailServicesAlongCorridor(sampled, radiusM, 55);
        const bbox = bboxFromPositions(sampled);
        setOsmOverpassCachePayload(
          cacheKey,
          "services",
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
    }

    const { south, west, north, east } = body;
    if (
      typeof south !== "number" ||
      typeof west !== "number" ||
      typeof north !== "number" ||
      typeof east !== "number"
    ) {
      return NextResponse.json(
        { error: "coordinates del percorso oppure south, west, north, east richiesti" },
        { status: 400 }
      );
    }
    if (north <= south || east <= west) {
      return NextResponse.json({ error: "bbox non valida" }, { status: 400 });
    }
    const b = padBbox(south, west, north, east, 0.012);
    const cacheKey = osmOverpassCacheKey("services", b.south, b.west, b.north, b.east);
    const hit = getOsmOverpassCachePayload(cacheKey);
    if (hit) {
      if (Math.random() < 0.05) pruneExpiredOsmOverpassCache();
      const parsed = JSON.parse(hit) as { pois: unknown };
      return NextResponse.json({ pois: parsed.pois, cached: true, stale: false, mode: "bbox" });
    }
    try {
      const pois = await fetchTrailServicesInBbox(b.south, b.west, b.north, b.east);
      setOsmOverpassCachePayload(
        cacheKey,
        "services",
        b.south,
        b.west,
        b.north,
        b.east,
        JSON.stringify({ pois })
      );
      return NextResponse.json({ pois, cached: false, stale: false, mode: "bbox" });
    } catch (err) {
      const staleRow = getOsmOverpassCachePayloadAllowStale(cacheKey);
      if (staleRow) {
        const parsed = JSON.parse(staleRow.payload_json) as { pois: unknown };
        return NextResponse.json({
          pois: parsed.pois,
          cached: true,
          stale: staleRow.stale,
          warning: err instanceof Error ? err.message : "Overpass non disponibile",
          mode: "bbox",
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
