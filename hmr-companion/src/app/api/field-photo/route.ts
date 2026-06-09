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
  const allowedRoot = path.join(process.cwd(), "data", "uploads", "field");
  if (!abs.startsWith(allowedRoot)) {
    return NextResponse.json({ error: "path non consentito" }, { status: 403 });
  }

  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: "File non trovato" }, { status: 404 });
  }

  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

  return new NextResponse(buf, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
