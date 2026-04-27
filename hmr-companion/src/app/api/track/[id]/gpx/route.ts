import fs from "node:fs";
import path from "node:path";
import { getTrack } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const t = getTrack(id);
  if (!t) {
    return new Response("Track non trovato", { status: 404 });
  }
  if (!t.gpx_path) {
    return new Response("GPX non disponibile", { status: 404 });
  }
  const abs = path.isAbsolute(t.gpx_path) ? t.gpx_path : path.join(process.cwd(), t.gpx_path);
  if (!fs.existsSync(abs)) {
    return new Response("File GPX mancante sul server", { status: 404 });
  }
  const buf = fs.readFileSync(abs);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="${path.basename(abs)}"`,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
