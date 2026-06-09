import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  getDb,
  getPoiNoteByPoiId,
  getTrack,
  listPhotosForNote,
  listPoiNotesForTrack,
  type PoiNoteStatus,
  upsertPoiNote,
} from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const VALID_STATUS: ReadonlyArray<PoiNoteStatus> = [
  "planned",
  "visited",
  "avoid",
  "info",
];

export async function GET(_req: Request, ctx: Ctx) {
  const { id: trackId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) {
    return NextResponse.json({ error: "track not found" }, { status: 404 });
  }

  const notes = listPoiNotesForTrack(trackId);
  return NextResponse.json({ notes });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: trackId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) {
    return NextResponse.json({ error: "track not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    poi_id?: string;
    status?: string;
    body?: string;
  };

  const poiId = body.poi_id?.trim();
  if (!poiId) {
    return NextResponse.json({ error: "poi_id richiesto" }, { status: 400 });
  }

  const poiRow = getDb()
    .prepare(`SELECT id FROM pois WHERE id = ? AND track_id = ?`)
    .get(poiId, trackId);
  if (!poiRow) {
    return NextResponse.json({ error: "POI non trovato" }, { status: 404 });
  }

  const status = (body.status ?? "visited") as PoiNoteStatus;
  if (!VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: "status non valido" }, { status: 400 });
  }

  const now = Date.now();
  const existing = getPoiNoteByPoiId(poiId);
  const note = upsertPoiNote({
    id: existing?.id ?? crypto.randomUUID(),
    poi_id: poiId,
    status,
    body: String(body.body ?? "").trim(),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });

  const photos = listPhotosForNote(note.id);
  return NextResponse.json({ note: { ...note, photos } });
}
