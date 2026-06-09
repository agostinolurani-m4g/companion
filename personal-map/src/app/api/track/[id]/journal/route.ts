import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getTrackForOwner, insertJournalEntry, listJournalEntries } from "@/lib/db";
import type { JournalEntryKind } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await ctx.params;
  const track = getTrackForOwner(id, auth.email);
  if (!track) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });

  return NextResponse.json({
    entries: listJournalEntries(id),
    journal_summary: track.journal_summary ?? null,
    sport_mode: track.sport_mode ?? null,
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await ctx.params;
  const track = getTrackForOwner(id, auth.email);
  if (!track) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });

  const body = (await req.json()) as {
    along_km: number;
    kind: JournalEntryKind;
    title?: string;
    body?: string;
    photo_path?: string;
  };

  if (typeof body.along_km !== "number" || !body.kind) {
    return NextResponse.json({ error: "along_km e kind richiesti" }, { status: 400 });
  }

  const entryId = crypto.randomUUID();
  const now = Date.now();
  insertJournalEntry({
    id: entryId,
    track_id: id,
    along_km: body.along_km,
    kind: body.kind,
    title: body.title ?? null,
    body: body.body ?? null,
    photo_path: body.photo_path ?? null,
    created_at: now,
  });

  return NextResponse.json({ id: entryId }, { status: 201 });
}
