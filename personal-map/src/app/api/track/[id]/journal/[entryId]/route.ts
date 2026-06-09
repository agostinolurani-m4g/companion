import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import {
  deleteJournalEntry,
  getJournalEntry,
  getTrackForOwner,
  updateJournalEntry,
} from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id, entryId } = await ctx.params;
  if (!getTrackForOwner(id, auth.email)) {
    return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  }

  const entry = getJournalEntry(entryId);
  if (!entry || entry.track_id !== id) {
    return NextResponse.json({ error: "Voce non trovata" }, { status: 404 });
  }

  const body = (await req.json()) as {
    title?: string | null;
    body?: string | null;
    along_km?: number;
  };

  updateJournalEntry(entryId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id, entryId } = await ctx.params;
  if (!getTrackForOwner(id, auth.email)) {
    return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  }

  const entry = getJournalEntry(entryId);
  if (!entry || entry.track_id !== id) {
    return NextResponse.json({ error: "Voce non trovata" }, { status: 404 });
  }

  deleteJournalEntry(entryId);
  return NextResponse.json({ ok: true });
}
