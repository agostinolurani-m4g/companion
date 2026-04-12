import { NextResponse } from "next/server";
import type { Position } from "geojson";
import { sampleElevationsForLine } from "@/lib/elevation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { coordinates?: Position[] };
    const coords = body.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      return NextResponse.json({ error: "coordinates richiesto (LineString)" }, { status: 400 });
    }
    const data = await sampleElevationsForLine(coords);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
