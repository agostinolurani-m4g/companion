import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getTrackForOwner, updateTrackJournalMeta } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await ctx.params;
  if (!getTrackForOwner(id, auth.email)) {
    return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  }

  const body = (await req.json()) as {
    journal_summary?: string | null;
    sport_mode?: string | null;
  };

  const ok = updateTrackJournalMeta(id, auth.email, body);
  if (!ok) return NextResponse.json({ error: "Nessuna modifica" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
