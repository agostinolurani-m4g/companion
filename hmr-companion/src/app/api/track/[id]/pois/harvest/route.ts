import { NextResponse } from "next/server";
import { getDb, getTrack } from "@/lib/db";
import { insertOsmNodesForTrack } from "@/lib/poi-osm-insert";
import { fetchAllPoiTypesAround, OverpassError } from "@/lib/overpass";
import type { StoredCoord } from "@/lib/track-coords";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type Body = {
  lat?: number;
  lng?: number;
  /** Raggio ricerca OSM attorno al clic (m), default 450. */
  radiusM?: number;
};

export async function POST(req: Request, ctx: Ctx) {
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
      : 450;

  let nodes: Awaited<ReturnType<typeof fetchAllPoiTypesAround>>;
  try {
    nodes = await fetchAllPoiTypesAround(lat, lng, radiusM);
  } catch (e) {
    const msg = e instanceof OverpassError ? e.message : (e as Error).message;
    const status = e instanceof OverpassError && e.transient ? 503 : 502;
    return NextResponse.json({ error: `Overpass: ${msg}` }, { status });
  }

  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  const db = getDb();
  const { inserted, skippedDetour, skippedUnclassified, pois } = insertOsmNodesForTrack(
    db,
    trackId,
    coords,
    nodes
  );

  return NextResponse.json({
    ok: true,
    osmReturned: nodes.length,
    inserted,
    skippedDetour,
    skippedUnclassified,
    pois,
  });
}
