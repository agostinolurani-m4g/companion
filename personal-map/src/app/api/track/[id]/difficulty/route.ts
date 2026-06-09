import { NextResponse } from "next/server";
import { analyzeTrackDifficulty } from "@/lib/analyze-track-difficulty";
import { requireAuthenticated } from "@/lib/auth";
import { getTrackForOwner, listTrackDifficultySegments } from "@/lib/db";
import { inferSportMode } from "@/lib/sport-modes";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await ctx.params;
  const track = getTrackForOwner(id, auth.email);
  if (!track) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });

  const segments = listTrackDifficultySegments(id);
  const sportMode = track.sport_mode ?? inferSportMode(track.activity_type);

  return NextResponse.json({ segments, sport_mode: sportMode });
}

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await ctx.params;
  const track = getTrackForOwner(id, auth.email);
  if (!track) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });

  try {
    const result = analyzeTrackDifficulty(id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analisi fallita" },
      { status: 500 }
    );
  }
}
