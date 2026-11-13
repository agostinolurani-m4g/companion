import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");
  if (!rel || rel.includes("..")) {
    return NextResponse.json({ error: "path non valido" }, { status: 400 });
  }

  const abs = path.join(process.cwd(), rel);
  const fieldRoot = path.join(process.cwd(), "data", "uploads", "field");
  const avatarRoot = path.join(process.cwd(), "data", "uploads", "avatars");
  // Upload v2 (foto di gite, mappa personale, segnalazioni, avatar dei gruppi): data/uploads/v2/…
  const v2PhotoRoot = path.join(process.cwd(), "data", "uploads", "v2");
  const allowed =
    abs.startsWith(fieldRoot + path.sep) || abs.startsWith(avatarRoot + path.sep) || abs.startsWith(v2PhotoRoot + path.sep);
  if (!allowed) {
    return NextResponse.json({ error: "path non consentito" }, { status: 403 });
  }

  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: "File non trovato" }, { status: 404 });
  }

  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".heic" || ext === ".heif"
          ? "image/heic"
          : "image/jpeg";

  return new NextResponse(buf, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
