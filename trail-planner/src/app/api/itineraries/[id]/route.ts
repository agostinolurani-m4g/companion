import { NextResponse } from "next/server";
import {
  deleteItinerary,
  getItinerary,
  getLatestTrackForItinerary,
  listMapPois,
  listRouteVariants,
  listStops,
  setActiveRouteVariant,
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
  const route_variants = listRouteVariants(id);
  return NextResponse.json({ itinerary: it, stops, map_pois, has_gpx_track, route_variants });
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
    active_route_variant_id?: string | null;
    safety_checklist_json?: string | null;
    planner_notes?: string | null;
  };
  let base = ex;
  if (body.active_route_variant_id !== undefined && body.active_route_variant_id !== null) {
    const switched = setActiveRouteVariant(id, body.active_route_variant_id);
    if (!switched) {
      return NextResponse.json({ error: "Variante non valida" }, { status: 400 });
    }
    base = getItinerary(id)!;
  }
  const row = upsertItineraryFull({
    id,
    name: body.name ?? base.name,
    start_date: body.start_date !== undefined ? body.start_date : base.start_date,
    end_date: body.end_date !== undefined ? body.end_date : base.end_date,
    activity: body.activity ?? base.activity,
    line_geojson: body.line_geojson !== undefined ? body.line_geojson : base.line_geojson,
    safety_checklist_json:
      body.safety_checklist_json !== undefined ? body.safety_checklist_json : base.safety_checklist_json ?? null,
    planner_notes:
      body.planner_notes !== undefined ? body.planner_notes : base.planner_notes ?? null,
  });
  return NextResponse.json({
    itinerary: row,
    route_variants: listRouteVariants(id),
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getItinerary(id)) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  deleteItinerary(id);
  return NextResponse.json({ ok: true });
}
