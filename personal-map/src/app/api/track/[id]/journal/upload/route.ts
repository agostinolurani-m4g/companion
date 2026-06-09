import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getTrackForOwner, insertJournalEntry } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await ctx.params;
  const track = getTrackForOwner(id, auth.email);
  if (!track) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  const alongKm = parseFloat(String(form.get("along_km") ?? ""));
  const title = String(form.get("title") ?? "").trim() || null;
  const bodyText = String(form.get("body") ?? "").trim() || null;

  if (!(file instanceof File) || !Number.isFinite(alongKm)) {
    return NextResponse.json({ error: "file e along_km richiesti" }, { status: 400 });
  }

  const entryId = crypto.randomUUID();
  const relDir = path.join("data", "uploads", "journal", id);
  const absDir = path.join(process.cwd(), relDir);
  fs.mkdirSync(absDir, { recursive: true });

  const ext = path.extname(file.name) || ".jpg";
  const filename = `${entryId}${ext}`;
  const relPath = path.join(relDir, filename);
  const absPath = path.join(process.cwd(), relPath);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absPath, buf);

  const now = Date.now();
  insertJournalEntry({
    id: entryId,
    track_id: id,
    along_km: alongKm,
    kind: "photo",
    title,
    body: bodyText,
    photo_path: relPath.replace(/\\/g, "/"),
    created_at: now,
  });

  return NextResponse.json({ id: entryId, photo_path: relPath.replace(/\\/g, "/") }, { status: 201 });
}
