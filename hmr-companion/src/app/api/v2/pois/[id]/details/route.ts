import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { buildPoiDetails } from "@/lib/poi-details";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type Body = {
  lat?: number;
  lng?: number;
  image?: string | null;
  wikidata?: string | null;
  wikipedia?: string | null;
};

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  if (!id?.trim()) return NextResponse.json({ error: "ID POI mancante" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const lat = body.lat;
  const lng = body.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Serve lat e lng numerici" }, { status: 400 });
  }

  const mapillaryToken = process.env.MAPILLARY_ACCESS_TOKEN?.trim() || null;

  try {
    const details = await buildPoiDetails({
      lat,
      lng,
      osmImage: body.image ?? null,
      wikidata: body.wikidata ?? null,
      wikipedia: body.wikipedia ?? null,
      mapillaryToken,
    });
    return NextResponse.json({ ok: true, id, ...details, mapillary: Boolean(mapillaryToken) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
