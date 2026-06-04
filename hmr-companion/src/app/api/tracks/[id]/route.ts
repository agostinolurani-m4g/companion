import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { deleteTrack, getTrack } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth) {
    return NextResponse.json(
      { error: "Solo l'amministratore può eliminare le gare." },
      { status: 403 }
    );
  }

  const { id } = await ctx.params;
  const track = getTrack(id);
  if (!track) {
    return NextResponse.json({ error: "Gara non trovata" }, { status: 404 });
  }

  const gpxPath = track.gpx_path?.trim();
  if (gpxPath) {
    const abs = path.isAbsolute(gpxPath) ? gpxPath : path.join(process.cwd(), gpxPath);
    const uploadsRoot = path.join(process.cwd(), "data", "uploads");
    if (abs.startsWith(uploadsRoot) && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* DB delete procede comunque */
      }
    }
  }

  const ok = deleteTrack(id);
  if (!ok) {
    return NextResponse.json({ error: "Eliminazione non riuscita" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deletedId: id });
}
