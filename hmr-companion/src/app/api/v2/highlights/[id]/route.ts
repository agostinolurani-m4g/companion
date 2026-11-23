import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { serializeHighlight } from "@/lib/highlights/serialize";
import { deleteHighlight, getHighlight, toggleHighlightVote } from "@/lib/highlights/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Dettaglio con le foto vicine. */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const { id } = await ctx.params;
  const h = getHighlight(getDb(), id, auth.email);
  if (!h) return NextResponse.json({ error: "Highlight non trovato" }, { status: 404 });
  return NextResponse.json({ highlight: serializeHighlight(h, auth.email, { photos: true }) });
}

/** POST → consiglia / togli il consiglio. */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const { id } = await ctx.params;
  const h = toggleHighlightVote(getDb(), id, auth.email, Date.now());
  if (!h) return NextResponse.json({ error: "Highlight non trovato" }, { status: 404 });
  return NextResponse.json({ highlight: serializeHighlight(h, auth.email, { photos: true }) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const { id } = await ctx.params;
  if (!deleteHighlight(getDb(), id, auth.email)) return NextResponse.json({ error: "Non puoi eliminarlo" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
