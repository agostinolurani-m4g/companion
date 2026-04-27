import { NextResponse } from "next/server";
import { deleteExplorePlace, updateExplorePlace } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Partial<{
      name: string;
      lat: number;
      lng: number;
      description: string;
      image_url: string;
      rating: number;
      review_count: number;
    }>;
    const place = updateExplorePlace(id, body);
    if (!place) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ place });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const ok = deleteExplorePlace(id);
    if (!ok) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
