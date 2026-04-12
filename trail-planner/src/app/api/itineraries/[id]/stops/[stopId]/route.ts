import { NextResponse } from "next/server";
import { deleteStop, getItinerary, getStop, updateStop } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; stopId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id: itineraryId, stopId } = await ctx.params;
  if (!getItinerary(itineraryId)) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  if (!getStop(stopId, itineraryId)) return NextResponse.json({ error: "Tappa non trovata" }, { status: 404 });
  const body = (await req.json()) as {
    lat?: number;
    lng?: number;
    name?: string;
    notes?: string | null;
    image_url?: string | null;
    website_url?: string | null;
    segment_type?: string;
  };
  const row = updateStop(stopId, itineraryId, {
    lat: body.lat,
    lng: body.lng,
    name: body.name,
    notes: body.notes,
    image_url: body.image_url,
    website_url: body.website_url,
    segment_type: body.segment_type,
  });
  if (!row) return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  return NextResponse.json({ stop: row });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id: itineraryId, stopId } = await ctx.params;
  if (!getItinerary(itineraryId)) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const ok = deleteStop(stopId, itineraryId);
  if (!ok) return NextResponse.json({ error: "Tappa non trovata" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
