import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { listGeoHazardCellsInBbox } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const url = new URL(req.url);
  const minLat = parseFloat(url.searchParams.get("minLat") ?? "");
  const minLng = parseFloat(url.searchParams.get("minLng") ?? "");
  const maxLat = parseFloat(url.searchParams.get("maxLat") ?? "");
  const maxLng = parseFloat(url.searchParams.get("maxLng") ?? "");

  if (![minLat, minLng, maxLat, maxLng].every(Number.isFinite)) {
    return NextResponse.json({ error: "bbox richiesto" }, { status: 400 });
  }

  const cells = listGeoHazardCellsInBbox(minLat, minLng, maxLat, maxLng);
  return NextResponse.json({ cells });
}
