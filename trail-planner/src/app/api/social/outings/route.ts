import { NextResponse } from "next/server";
import { getActiveUserId, insertOuting } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const viewer = getActiveUserId();
    if (!viewer) {
      return NextResponse.json(
        { error: "Imposta un utente attivo nel profilo." },
        { status: 400 }
      );
    }
    const body = (await req.json()) as {
      route_id: string;
      author_user_id?: string;
      started_at: string;
      visibility: string;
      group_id?: string | null;
      snow_conditions_text?: string | null;
      weather_snapshot_json?: string | null;
      notes?: string | null;
      itinerary_id?: string | null;
      track_id?: string | null;
      participant_user_ids?: string[];
    };
    if (!body.route_id?.trim() || !body.started_at || !body.visibility) {
      return NextResponse.json({ error: "route_id, started_at, visibility obbligatori" }, { status: 400 });
    }
    const author = body.author_user_id?.trim() || viewer;
    const row = insertOuting({
      route_id: body.route_id.trim(),
      author_user_id: author,
      started_at: body.started_at,
      visibility: body.visibility,
      group_id: body.group_id,
      snow_conditions_text: body.snow_conditions_text,
      weather_snapshot_json: body.weather_snapshot_json,
      notes: body.notes,
      itinerary_id: body.itinerary_id,
      track_id: body.track_id,
      participant_user_ids: body.participant_user_ids,
    });
    return NextResponse.json({ outing: row });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
