import { NextResponse } from "next/server";
import { getItinerary, reorderStops, reorderStopsInLeg } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getItinerary(id)) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const body = (await req.json()) as { orderedIds?: string[]; legIndex?: number };
  if (!Array.isArray(body.orderedIds) || body.orderedIds.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "orderedIds (string[]) richiesto" }, { status: 400 });
  }
  const ok =
    typeof body.legIndex === "number" && Number.isFinite(body.legIndex)
      ? reorderStopsInLeg(id, Math.max(0, Math.floor(body.legIndex)), body.orderedIds)
      : reorderStops(id, body.orderedIds);
  if (!ok) return NextResponse.json({ error: "Ordine non valido" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
