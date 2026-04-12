import { NextResponse } from "next/server";
import { getLatestTrackForItinerary, listRecentTracks } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const itineraryId = searchParams.get("itinerary_id");
  try {
    if (itineraryId) {
      const t = getLatestTrackForItinerary(itineraryId);
      return NextResponse.json({ track: t ?? null });
    }
    const tracks = listRecentTracks(30);
    return NextResponse.json({ tracks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
