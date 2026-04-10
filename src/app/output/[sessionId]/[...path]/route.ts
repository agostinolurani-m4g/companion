import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function safeSessionId(id: string): string | null {
  const s = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return s && s.length <= 80 ? s : null;
}

function safePathUnderRoot(root: string, rel: string): string | null {
  const parts = rel.split(/[/\\]+/).filter(Boolean);
  if (parts.some((p) => p === "..")) return null;
  const full = path.resolve(root, ...parts);
  const rootR = path.resolve(root) + path.sep;
  if (!full.startsWith(rootR) && full !== path.resolve(root)) return null;
  return full;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string; path?: string[] }> }
) {
  const { sessionId: raw, path: segments } = await ctx.params;
  const sessionId = safeSessionId(raw);
  if (!sessionId) {
    return new NextResponse("Bad request", { status: 400 });
  }
  const rel = (segments ?? []).join("/") || "index.html";
  const root = path.resolve(process.cwd(), "output", sessionId);
  const filePath = safePathUnderRoot(root, rel);
  if (!filePath) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return new NextResponse("Not found", { status: 404 });
  }
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store",
    },
  });
}
