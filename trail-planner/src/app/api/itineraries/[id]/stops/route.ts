import { NextResponse } from "next/server";
import type { Feature, LineString } from "geojson";
import type { Position } from "geojson";
import { addStop, addStopAtOrder, getItinerary, listStops } from "@/lib/db";
import { computeInsertionOrderIndex } from "@/lib/stop-insertion";

function coordsFromItineraryLine(lineGeojson: string | null | undefined): Position[] | null {
  if (!lineGeojson?.trim()) return null;
  try {
    const f = JSON.parse(lineGeojson) as Feature<LineString>;
    const c = f?.geometry?.coordinates;
    if (f?.geometry?.type === "LineString" && Array.isArray(c) && c.length >= 2) {
      return c as Position[];
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getItinerary(id)) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  return NextResponse.json({ stops: listStops(id) });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const itinerary = getItinerary(id);
  if (!itinerary) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const body = (await req.json()) as {
    segment_type?: string;
    name?: string;
    lat?: number;
    lng?: number;
    notes?: string | null;
    image_url?: string | null;
    website_url?: string | null;
    /** Se true (default), inserisce la tappa lungo il percorso tra due tappe vicine al click. */
    auto_order?: boolean;
    order_index?: number;
  };
  if (
    !body.segment_type ||
    !body.name?.trim() ||
    typeof body.lat !== "number" ||
    typeof body.lng !== "number"
  ) {
    return NextResponse.json({ error: "segment_type, name, lat, lng obbligatori" }, { status: 400 });
  }

  const common = {
    itinerary_id: id,
    segment_type: body.segment_type,
    name: body.name.trim(),
    lat: body.lat,
    lng: body.lng,
    notes: body.notes ?? null,
    image_url: body.image_url?.trim() ? body.image_url.trim() : null,
    website_url: body.website_url?.trim() ? body.website_url.trim() : null,
  };

  let stop;
  if (typeof body.order_index === "number" && Number.isFinite(body.order_index)) {
    stop = addStopAtOrder(common, Math.max(0, Math.floor(body.order_index)));
  } else if (body.auto_order !== false) {
    const sorted = listStops(id);
    const lineCoords = coordsFromItineraryLine(itinerary.line_geojson);
    const k = computeInsertionOrderIndex(sorted, body.lat, body.lng, lineCoords);
    stop = addStopAtOrder(common, k);
  } else {
    stop = addStop(common);
  }
  return NextResponse.json({ stop });
}
