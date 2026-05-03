import { NextResponse } from "next/server";
import {
  buildFullRoadbook,
  buildRoadbookAhead,
  ROADBOOK_SCHEMA_VERSION,
} from "@/lib/roadbook-chunk";
import { loadRoadbookChunksInput } from "@/lib/roadbook-data";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const input = loadRoadbookChunksInput(id);
  if (!input) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });

  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "1";
  const chunkKm = Math.max(1, Number(url.searchParams.get("chunkKm") ?? "10"));
  const maxDetourM = Math.max(0, Number(url.searchParams.get("maxDetourM") ?? "1500"));

  const payload = { ...input, chunkKm, maxDetourM };

  if (full) {
    const chunks = buildFullRoadbook(payload);
    return NextResponse.json({
      schema_version: ROADBOOK_SCHEMA_VERSION,
      track_id: id,
      length_km: input.lengthKm,
      chunk_km: chunkKm,
      chunks,
    });
  }

  const atKm = Number(url.searchParams.get("atKm") ?? "0");
  const aheadChunks = Math.min(50, Math.max(1, Number(url.searchParams.get("aheadChunks") ?? "8")));
  if (!Number.isFinite(atKm)) {
    return NextResponse.json({ error: "atKm non valido" }, { status: 400 });
  }

  const chunks = buildRoadbookAhead(payload, atKm, aheadChunks, chunkKm);
  return NextResponse.json({
    schema_version: ROADBOOK_SCHEMA_VERSION,
    track_id: id,
    length_km: input.lengthKm,
    chunk_km: chunkKm,
    at_km: Math.max(0, Math.min(input.lengthKm, atKm)),
    chunks,
  });
}
