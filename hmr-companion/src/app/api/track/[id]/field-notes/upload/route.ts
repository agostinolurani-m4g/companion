import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  getDb,
  getPoiNoteByPoiId,
  getTrack,
  insertPoiFieldPhoto,
  listPhotosForNote,
  upsertPoiNote,
} from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id: trackId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) {
    return NextResponse.json({ error: "track not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const poiId = String(form.get("poi_id") ?? "").trim();
  const noteId = String(form.get("note_id") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file richiesto" }, { status: 400 });
  }
  if (!poiId && !noteId) {
    return NextResponse.json({ error: "poi_id o note_id richiesto" }, { status: 400 });
  }

  let resolvedNoteId = noteId;

  if (!resolvedNoteId && poiId) {
    const poiRow = getDb()
      .prepare(`SELECT id FROM pois WHERE id = ? AND track_id = ?`)
      .get(poiId, trackId);
    if (!poiRow) {
      return NextResponse.json({ error: "POI non trovato" }, { status: 404 });
    }

    const now = Date.now();
    const existing = getPoiNoteByPoiId(poiId);
    const note = upsertPoiNote({
      id: existing?.id ?? crypto.randomUUID(),
      poi_id: poiId,
      status: existing?.status ?? "info",
      body: existing?.body ?? "",
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    resolvedNoteId = note.id;
  }

  const relDir = path.join("data", "uploads", "field", trackId);
  const absDir = path.join(process.cwd(), relDir);
  fs.mkdirSync(absDir, { recursive: true });

  const photoId = crypto.randomUUID();
  const ext = path.extname(file.name) || ".jpg";
  const filename = `${photoId}${ext}`;
  const relPath = path.join(relDir, filename).replace(/\\/g, "/");
  const absPath = path.join(process.cwd(), relPath);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absPath, buf);

  const photo = insertPoiFieldPhoto({
    id: photoId,
    note_id: resolvedNoteId,
    photo_path: relPath,
    created_at: Date.now(),
  });

  const note = getDb()
    .prepare(`SELECT * FROM notes WHERE id = ?`)
    .get(resolvedNoteId);
  const photos = listPhotosForNote(resolvedNoteId);

  return NextResponse.json({ photo, note, photos }, { status: 201 });
}
