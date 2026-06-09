import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getGeoHazardCell } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ cellId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { cellId } = await ctx.params;
  const cell = getGeoHazardCell(decodeURIComponent(cellId));
  if (!cell) return NextResponse.json({ error: "Cella non trovata" }, { status: 404 });

  return NextResponse.json({ cell });
}
