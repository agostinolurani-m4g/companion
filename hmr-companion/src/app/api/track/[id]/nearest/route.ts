import { NextResponse } from "next/server";
import { getTrack } from "@/lib/db";
import {
  cumFromStored,
  coordsFromStored,
  type StoredCoord,
} from "@/lib/track-coords";
import { nearestPointOnPolyline } from "@/lib/track-geometry";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Proietta una coppia lat/lng sulla traccia (per capire "dove sono" senza calcolarlo dal client). */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const t = getTrack(id);
  if (!t) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat e lng richiesti" }, { status: 400 });
  }

  const stored = JSON.parse(t.coords_json) as StoredCoord[];
  const coords = coordsFromStored(stored);
  const cum = cumFromStored(stored);
  const proj = nearestPointOnPolyline(coords, [lng, lat], cum);
  if (!proj) return NextResponse.json({ error: "traccia non valida" }, { status: 500 });

  return NextResponse.json({
    along_km: Number(proj.alongKm.toFixed(3)),
    detour_m: Math.round(proj.distKm * 1000),
    closest: { lat: proj.closest[1], lng: proj.closest[0] },
    length_km: t.length_km,
  });
}
