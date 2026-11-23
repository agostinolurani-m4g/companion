import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { snowCellsForBbox, snowCellsToGeoJson } from "@/lib/snow-depth";
import { snowDepthForCells } from "@/lib/snow-depth-server";

export const runtime = "nodejs";

/** GET ?bbox=south,west,north,east&zoom= → celle con altezza neve modellata (cm). */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const url = new URL(req.url);
  const parts = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "bbox non valido (south,west,north,east)" }, { status: 400 });
  }
  const [south, west, north, east] = parts;
  const zoom = Number(url.searchParams.get("zoom") ?? 10);
  const cells = snowCellsForBbox({ south, west, north, east }, Number.isFinite(zoom) ? zoom : 10, 400);
  const withDepth = await snowDepthForCells(getDb(), cells, Date.now());
  return NextResponse.json(
    { geojson: snowCellsToGeoJson(withDepth), step: cells[0]?.size ?? null, source: "Open-Meteo" },
    { headers: { "Cache-Control": "private, max-age=600" } },
  );
}
