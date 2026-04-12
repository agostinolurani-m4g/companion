import { NextResponse } from "next/server";
import { deleteMapPoiForItinerary, getItinerary } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; poiId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id, poiId } = await ctx.params;
  if (!getItinerary(id)) {
    return NextResponse.json({ error: "Itinerario non trovato" }, { status: 404 });
  }
  const ok = deleteMapPoiForItinerary(poiId, id);
  if (!ok) return NextResponse.json({ error: "POI non trovato" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
