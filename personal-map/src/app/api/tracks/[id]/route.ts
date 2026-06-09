import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { deleteTrack, getTrackForOwner } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const track = getTrackForOwner(id, auth.email);
  if (!track) {
    return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  }

  const ok = deleteTrack(id);
  if (!ok) {
    return NextResponse.json({ error: "Eliminazione non riuscita" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, trackId: id });
}
