import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import {
  assertCanIngest,
  consumeIngestCredit,
  getIngestCreditsInfo,
} from "@/lib/ingest-credits";
import { countPois, getTrack } from "@/lib/db";
import { runFullTrackSnapshot } from "@/lib/run-track-snapshot";

export const runtime = "nodejs";
export const maxDuration = 900;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const track = getTrack(id);
  if (!track) {
    return NextResponse.json({ error: "Gara non trovata" }, { status: 404 });
  }

  const creditsBefore = getIngestCreditsInfo(auth.email);
  if (!creditsBefore.canIngest) {
    return NextResponse.json(
      { error: "Credito ingest esaurito.", credits: creditsBefore },
      { status: 402 }
    );
  }

  try {
    assertCanIngest(auth.email);
    const { poiCount } = await runFullTrackSnapshot(id, { webFast: true });
    consumeIngestCredit(auth.email);

    return NextResponse.json({
      trackId: id,
      snapshotComplete: true,
      poiCount: poiCount || countPois(id),
      credits: getIngestCreditsInfo(auth.email),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Snapshot non riuscito";
    return NextResponse.json(
      {
        error: msg,
        trackId: id,
        snapshotComplete: false,
        poiCount: countPois(id),
        credits: getIngestCreditsInfo(auth.email),
      },
      { status: 500 }
    );
  }
}
