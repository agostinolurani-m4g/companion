import { NextResponse } from "next/server";
import { getActiveUserId, getItinerary, publishOutingFromItinerary } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const viewer = getActiveUserId();
    if (!viewer) {
      return NextResponse.json(
        { error: "Imposta un utente attivo nel profilo (tab Io → profilo)." },
        { status: 400 }
      );
    }
    const { id: itinerary_id } = await ctx.params;
    if (!getItinerary(itinerary_id)) {
      return NextResponse.json({ error: "Itinerario non trovato" }, { status: 404 });
    }
    const body = (await req.json()) as {
      started_at?: string;
      visibility?: string;
      group_id?: string | null;
      notes?: string | null;
      snow_conditions_text?: string | null;
      weather_snapshot_json?: string | null;
    };
    const started_at = body.started_at?.trim() || new Date().toISOString();
    const visibility = body.visibility?.trim() || "friends";
    const allowed = ["private", "friends", "group", "followers", "public"];
    if (!allowed.includes(visibility)) {
      return NextResponse.json({ error: "visibility non valida" }, { status: 400 });
    }
    const { route, outing } = publishOutingFromItinerary({
      itinerary_id,
      author_user_id: viewer,
      started_at,
      visibility,
      group_id: body.group_id ?? null,
      notes: body.notes ?? null,
      snow_conditions_text: body.snow_conditions_text ?? null,
      weather_snapshot_json: body.weather_snapshot_json ?? null,
    });
    return NextResponse.json({ route, outing });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore";
    const status = msg.includes("Serve una traccia") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
