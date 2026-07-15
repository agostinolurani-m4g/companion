import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OPENSLOPEMAP_BASE =
  process.env.OPENSLOPEMAP_TILE_BASE?.trim() ||
  "https://tileserver1.openslopemap.org/OSloOVERLAY_LR_Alps_16";

/** 1×1 PNG trasparente — tile assente (fuori copertura o zoom). */
const EMPTY_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function tileResponse(body: Buffer, extraHeaders?: Record<string, string>) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "X-Attribution": "© OpenSlopeMap.org",
      ...extraHeaders,
    },
  });
}

type Ctx = { params: Promise<{ z: string; x: string; y: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { z, x, y } = await ctx.params;
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);
  if (!Number.isFinite(zi) || !Number.isFinite(xi) || !Number.isFinite(yi)) {
    return new NextResponse("Invalid tile", { status: 400 });
  }
  if (zi < 0 || zi > 16) {
    return tileResponse(EMPTY_TILE, { "X-Tile-Status": "empty-zoom" });
  }

  const url = `${OPENSLOPEMAP_BASE}/${zi}/${xi}/${yi}.png`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "hmr-companion/0.1 (ski slope proxy)" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      if (res.status === 404) return tileResponse(EMPTY_TILE, { "X-Tile-Status": "empty-upstream" });
      return new NextResponse(null, { status: 502 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return tileResponse(buf);
  } catch {
    return new NextResponse("Upstream error", { status: 502 });
  }
}
