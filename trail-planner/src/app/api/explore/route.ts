import { NextResponse } from "next/server";
import { insertExplorePlace, listExplorePlaces } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ places: listExplorePlaces() });
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
      name?: string;
      lat?: number;
      lng?: number;
      description?: string;
      image_url?: string;
      rating?: number;
      review_count?: number;
    };
    if (!body.name?.trim() || typeof body.lat !== "number" || typeof body.lng !== "number") {
      return NextResponse.json({ error: "name, lat, lng obbligatori" }, { status: 400 });
    }
    const place = insertExplorePlace({
      name: body.name.trim(),
      lat: body.lat,
      lng: body.lng,
      description: body.description,
      image_url: body.image_url,
      rating: body.rating,
      review_count: body.review_count,
    });
    return NextResponse.json({ place });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
