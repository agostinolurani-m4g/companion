import { NextResponse } from "next/server";
import { addStop, addStopAtOrder, getItinerary, listStops } from "@/lib/db";
import { enrichAndPersistStopIfLodging } from "@/lib/lodging-enrich";
import { appendInsertionOrderIndex, sortStopsByOrder } from "@/lib/leg-stops";
import type { WaypointRole } from "@/lib/types";

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
    waypoint_role?: WaypointRole;
    name?: string;
    lat?: number;
    lng?: number;
    notes?: string | null;
    image_url?: string | null;
    website_url?: string | null;
    phone?: string | null;
    /** Se true (default), inserisce la tappa lungo il percorso tra due tappe vicine al click. */
    auto_order?: boolean;
    order_index?: number;
    /** Giornata (0 = primo giorno). Inserimento in coda a quella giornata. */
    leg_index?: number;
  };
  if (
    !body.segment_type ||
    !body.name?.trim() ||
    typeof body.lat !== "number" ||
    typeof body.lng !== "number"
  ) {
    return NextResponse.json({ error: "segment_type, name, lat, lng obbligatori" }, { status: 400 });
  }

  const legIdx =
    typeof body.leg_index === "number" && Number.isFinite(body.leg_index)
      ? Math.max(0, Math.floor(body.leg_index))
      : 0;

  const common = {
    itinerary_id: id,
    segment_type: body.segment_type,
    name: body.name.trim(),
    lat: body.lat,
    lng: body.lng,
    notes: body.notes ?? null,
    image_url: body.image_url?.trim() ? body.image_url.trim() : null,
    website_url: body.website_url?.trim() ? body.website_url.trim() : null,
    phone: body.phone?.trim() ? body.phone.trim() : null,
    waypoint_role: body.waypoint_role,
    leg_index: legIdx,
  };

  let stop;
  if (typeof body.order_index === "number" && Number.isFinite(body.order_index)) {
    stop = addStopAtOrder(common, Math.max(0, Math.floor(body.order_index)));
  } else if (body.auto_order !== false) {
    const sorted = sortStopsByOrder(listStops(id));
    const k = appendInsertionOrderIndex(sorted, legIdx);
    stop = addStopAtOrder(common, k);
  } else {
    stop = addStop(common);
  }

  if (common.segment_type === "lodging") {
    const enriched = await enrichAndPersistStopIfLodging(id, stop.id);
    if (enriched) stop = enriched;
  }

  return NextResponse.json({ stop });
}
