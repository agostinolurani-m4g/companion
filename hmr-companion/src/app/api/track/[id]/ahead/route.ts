import { NextResponse } from "next/server";
import {
  getTrack,
  listCheckpoints,
  listPois,
  listResupply,
  type PoiCategory,
} from "@/lib/db";

export const runtime = "nodejs";

const CATS: PoiCategory[] = ["water", "hut", "lodging", "shop", "restaurant", "pharmacy", "atm", "bus"];

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const track = getTrack(id);
  if (!track) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });

  const url = new URL(req.url);
  const atKm = Number(url.searchParams.get("atKm") ?? "0");
  const windowKm = Math.max(1, Number(url.searchParams.get("windowKm") ?? "30"));
  const maxDetourM = Number(url.searchParams.get("maxDetourM") ?? "1500");
  if (!Number.isFinite(atKm)) {
    return NextResponse.json({ error: "atKm non valido" }, { status: 400 });
  }
  const fromKm = Math.max(0, atKm);
  const toKm = Math.min(track.length_km + 1, atKm + windowKm);

  const pois = listPois(id, { fromKm, toKm, maxDetourM });

  const nextByCategory: Record<string, unknown> = {};
  for (const cat of CATS) {
    const found = pois.find((p) => p.category === cat);
    if (found) nextByCategory[cat] = { ...found, ahead_km: Number((found.along_km - atKm).toFixed(2)) };
  }

  const nextCheckpoint = listCheckpoints(id)
    .filter((c) => c.along_km >= atKm - 0.1)
    .sort((a, b) => a.along_km - b.along_km)[0] ?? null;

  const nextResupply = listResupply(id)
    .filter((r) => r.along_km >= atKm - 0.1)
    .sort((a, b) => a.along_km - b.along_km)[0] ?? null;

  return NextResponse.json({
    atKm,
    windowKm,
    fromKm,
    toKm,
    nextByCategory,
    nextCheckpoint: nextCheckpoint
      ? { ...nextCheckpoint, ahead_km: Number((nextCheckpoint.along_km - atKm).toFixed(2)) }
      : null,
    nextResupply: nextResupply
      ? { ...nextResupply, ahead_km: Number((nextResupply.along_km - atKm).toFixed(2)) }
      : null,
    pois,
  });
}
