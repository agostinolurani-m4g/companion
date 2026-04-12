import { NextResponse } from "next/server";
import {
  deleteItinerary,
  getItinerary,
  getLatestTrackForItinerary,
  listMapPois,
  listStops,
  upsertItineraryFull,
} from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const it = getItinerary(id);
  if (!it) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const stops = listStops(id);
  const map_pois = listMapPois(id);
  const has_gpx_track = !!getLatestTrackForItinerary(id);
  return NextResponse.json({ itinerary: it, stops, map_pois, has_gpx_track });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ex = getItinerary(id);
  if (!ex) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const body = (await req.json()) as {
    name?: string;
    start_date?: string | null;
    end_date?: string | null;
    activity?: string;
    line_geojson?: string | null;
  };
  const row = upsertItineraryFull({
    id,
    name: body.name ?? ex.name,
    start_date: body.start_date !== undefined ? body.start_date : ex.start_date,
    end_date: body.end_date !== undefined ? body.end_date : ex.end_date,
    activity: body.activity ?? ex.activity,
    line_geojson: body.line_geojson !== undefined ? body.line_geojson : ex.line_geojson,
  });
  return NextResponse.json({ itinerary: row });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getItinerary(id)) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  deleteItinerary(id);
  return NextResponse.json({ ok: true });
}
