import { NextResponse } from "next/server";
import {
  listCheckpoints,
  listPois,
  listResupply,
  type CheckpointRow,
  type PoiCategory,
  type ResupplyRow,
} from "@/lib/db";
import { buildRoadbookAlerts } from "@/lib/roadbook-alerts";
import { buildRoadbookAhead, chunkIndexAtKm, ROADBOOK_SCHEMA_VERSION } from "@/lib/roadbook-chunk";
import { loadRoadbookChunksInput } from "@/lib/roadbook-data";
import {
  buildRaceOverview,
  overviewCacheKey,
  overviewFromChunksDeterministic,
} from "@/lib/race-overview";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const CATS: PoiCategory[] = [
  "water",
  "hut",
  "lodging",
  "campsite",
  "shop",
  "restaurant",
  "pharmacy",
  "atm",
  "bus",
];

function nextCheckpoint(atKm: number, rows: CheckpointRow[]): (CheckpointRow & { ahead_km: number }) | null {
  const next = rows.filter((c) => c.along_km >= atKm - 0.1).sort((a, b) => a.along_km - b.along_km)[0];
  if (!next) return null;
  return { ...next, ahead_km: Number((next.along_km - atKm).toFixed(2)) };
}

function nextResupply(atKm: number, rows: ResupplyRow[]): (ResupplyRow & { ahead_km: number }) | null {
  const next = rows.filter((r) => r.along_km >= atKm - 0.1).sort((a, b) => a.along_km - b.along_km)[0];
  if (!next) return null;
  return { ...next, ahead_km: Number((next.along_km - atKm).toFixed(2)) };
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const input = loadRoadbookChunksInput(id);
  if (!input) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });

  const url = new URL(req.url);
  let atKm = Number(url.searchParams.get("atKm") ?? "0");
  if (!Number.isFinite(atKm)) {
    return NextResponse.json({ error: "atKm non valido" }, { status: 400 });
  }
  atKm = Math.max(0, Math.min(input.lengthKm, atKm));

  const chunkKm = Math.max(1, Number(url.searchParams.get("chunkKm") ?? "10"));
  const aheadChunks = Math.min(12, Math.max(2, Number(url.searchParams.get("aheadChunks") ?? "6")));
  const maxDetourM = Math.max(0, Number(url.searchParams.get("maxDetourM") ?? "1500"));
  const withOverview = url.searchParams.get("withOverview") === "1";

  const payload = { ...input, chunkKm, maxDetourM };
  const chunks = buildRoadbookAhead(payload, atKm, aheadChunks, chunkKm);

  const checkpoints = listCheckpoints(id);
  const resupply = listResupply(id);
  const pois = listPois(id);

  const alerts = buildRoadbookAlerts({
    atKm,
    lengthKm: input.lengthKm,
    pois,
    resupply,
    maxDetourM,
    chunksAhead: chunks,
  });

  const det = overviewFromChunksDeterministic(chunks);
  const startIdx = chunkIndexAtKm(atKm, input.lengthKm, chunkKm);
  const cacheKey = overviewCacheKey(id, startIdx, chunks.length);

  const overview = await buildRaceOverview(chunks, {
    useLlm: withOverview,
    cacheKey,
  });

  const windowKm = 60;
  const nextCat: Record<string, unknown> = {};
  for (const cat of CATS) {
    const found = listPois(id, {
      categories: [cat],
      fromKm: atKm,
      toKm: atKm + windowKm,
      maxDetourM,
    })[0];
    if (found) nextCat[cat] = { ...found, ahead_km: Number((found.along_km - atKm).toFixed(2)) };
  }

  return NextResponse.json({
    schema_version: ROADBOOK_SCHEMA_VERSION,
    track_id: id,
    at_km: atKm,
    remaining_km: Number(Math.max(0, input.lengthKm - atKm).toFixed(2)),
    chunk_km: chunkKm,
    next_checkpoint: nextCheckpoint(atKm, checkpoints),
    next_resupply: nextResupply(atKm, resupply),
    next_by_category: nextCat,
    chunks,
    alerts,
    overview_bullets_it: det.bullets_it,
    overview_text: overview.text_it,
    overview_source: overview.source,
  });
}
