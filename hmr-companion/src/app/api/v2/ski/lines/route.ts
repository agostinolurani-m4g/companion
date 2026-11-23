import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { skiLineFeatures, type SkiLineSource } from "@/lib/ski-lines";

export const runtime = "nodejs";

/** GET ?bbox=south,west,north,east → discese degli itinerari pubblici di sci, colorate per difficoltà. */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const url = new URL(req.url);
  const parts = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "bbox non valido (south,west,north,east)" }, { status: 400 });
  }
  const [south, west, north, east] = parts;
  const rows = getDb()
    .prepare(
      `SELECT id, name, geojson, meta_json FROM user_routes
       WHERE activity = 'ski' AND visibility = 'public'
         AND bbox_e >= ? AND bbox_w <= ? AND bbox_n >= ? AND bbox_s <= ?
       ORDER BY updated_at DESC LIMIT 400`,
    )
    .all(west, east, south, north) as SkiLineSource[];
  return NextResponse.json({ geojson: { type: "FeatureCollection", features: rows.flatMap(skiLineFeatures) } });
}
