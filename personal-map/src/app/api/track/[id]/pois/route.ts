import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getTrackForOwner, listPois, type PoiCategory } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const track = getTrackForOwner(id, auth.email);
  if (!track) {
    return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const cats = searchParams.get("categories");
  const categories = cats
    ? (cats.split(",").filter(Boolean) as PoiCategory[])
    : undefined;

  const pois = listPois(id, {
    categories,
    fromKm: searchParams.has("fromKm") ? Number(searchParams.get("fromKm")) : undefined,
    toKm: searchParams.has("toKm") ? Number(searchParams.get("toKm")) : undefined,
    maxDetourM: searchParams.has("maxDetourM") ? Number(searchParams.get("maxDetourM")) : undefined,
  });

  return NextResponse.json({ trackId: id, pois });
}
