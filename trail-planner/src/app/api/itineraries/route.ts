import { NextResponse } from "next/server";
import { createItinerary, listItineraries } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = listItineraries();
    return NextResponse.json({ itineraries: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name: string;
      start_date?: string | null;
      end_date?: string | null;
      activity?: string;
      line_geojson?: string | null;
    };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name obbligatorio" }, { status: 400 });
    }
    const row = createItinerary({
      name: body.name.trim(),
      start_date: body.start_date ?? null,
      end_date: body.end_date ?? null,
      activity: body.activity,
      line_geojson: body.line_geojson ?? null,
    });
    return NextResponse.json({ itinerary: row });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
