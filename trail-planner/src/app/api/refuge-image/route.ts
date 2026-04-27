import { NextResponse } from "next/server";
import { fetchWikipediaImageUrlForQuery } from "@/lib/refuge-wiki-image";

export const runtime = "nodejs";

/** Anteprima immagine da Wikipedia (it) per nome rifugio / POI. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q obbligatorio" }, { status: 400 });

  const img = await fetchWikipediaImageUrlForQuery(q);
  return NextResponse.json({ image_url: img });
}
