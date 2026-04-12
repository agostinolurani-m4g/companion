import { NextResponse } from "next/server";
import { fetchDrinkingWaterInBbox, padBbox } from "@/lib/overpass";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      south?: number;
      west?: number;
      north?: number;
      east?: number;
    };
    const { south, west, north, east } = body;
    if (
      typeof south !== "number" ||
      typeof west !== "number" ||
      typeof north !== "number" ||
      typeof east !== "number"
    ) {
      return NextResponse.json({ error: "south, west, north, east richiesti" }, { status: 400 });
    }
    if (north <= south || east <= west) {
      return NextResponse.json({ error: "bbox non valida" }, { status: 400 });
    }
    const b = padBbox(south, west, north, east, 0.015);
    const pois = await fetchDrinkingWaterInBbox(b.south, b.west, b.north, b.east);
    return NextResponse.json({ pois });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Overpass non disponibile" },
      { status: 500 }
    );
  }
}
