import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { personLabel, serializeSegment } from "@/lib/segments/serialize";
import {
  canViewSegment,
  deleteSegment,
  getAthleteGender,
  type Gender,
  getSegment,
  matchActivityOnSegment,
  myEfforts,
  segmentEffortCounts,
  segmentLeaderboard,
  segmentLegends,
  stravaActivitiesMissingTimes,
} from "@/lib/segments/store";
import { getActivity } from "@/lib/activities/store";
import { hydrateStravaTimes } from "@/lib/integrations/sync";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const PERIODS: Record<string, number> = {
  all: 0,
  year: 365 * 24 * 3600 * 1000,
  month: 30 * 24 * 3600 * 1000,
};

/** Dettaglio: classifica tempi, Local Legend (90 gg), i miei passaggi. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const { id } = await ctx.params;
  const db = getDb();
  const seg = getSegment(db, id);
  if (!seg || !canViewSegment(seg, auth.email)) {
    return NextResponse.json({ error: "Segmento non trovato" }, { status: 404 });
  }
  const url = new URL(req.url);
  const now = Date.now();
  const period = url.searchParams.get("period") ?? "all";
  const since = PERIODS[period] ? now - PERIODS[period] : 0;
  const g = url.searchParams.get("gender");
  const gender = g === "f" || g === "m" || g === "x" ? (g as Exclude<Gender, "">) : undefined;

  // Strava: il polyline riassuntivo non ha orari. Completa con gli stream
  // (poche attività per volta) e ricalcola i passaggi di quelle.
  if (url.searchParams.get("hydrate") === "1") {
    const missing = stravaActivitiesMissingTimes(db, seg, auth.email, 8);
    const updated = await hydrateStravaTimes(
      db,
      auth.email,
      missing.map((a) => ({ id: a.id, external_id: a.external_id })),
    ).catch(() => [] as string[]);
    for (const aid of updated) {
      const act = getActivity(db, aid);
      if (act) matchActivityOnSegment(db, seg, act, now);
    }
  }

  const leaderboard = segmentLeaderboard(db, id, auth.email, { since, limit: 50, gender });
  const legends = segmentLegends(db, id, auth.email, now, 20, gender);
  const mine = myEfforts(db, id, auth.email);
  const timed = mine.filter((e) => e.elapsed_s != null);
  const pr = timed.length ? Math.min(...timed.map((e) => e.elapsed_s as number)) : null;
  const missingTimes = mine.filter((e) => e.elapsed_s == null && e.provider === "strava").length;

  return NextResponse.json({
    segment: serializeSegment(seg, { geometry: true }),
    owner: personLabel(seg.owner),
    counts: segmentEffortCounts(db, id, auth.email),
    leaderboard: leaderboard.map((e) => ({ ...e, person: personLabel(e.owner), me: e.owner === auth.email })),
    legends: legends.map((e) => ({ ...e, person: personLabel(e.owner), me: e.owner === auth.email })),
    my_efforts: mine,
    my_pr_s: pr,
    my_rank: leaderboard.find((e) => e.owner === auth.email)?.rank ?? null,
    my_strava_missing_times: missingTimes,
    can_delete: seg.owner === auth.email,
    my_gender: getAthleteGender(db, auth.email),
    gender: gender ?? null,
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const { id } = await ctx.params;
  const db = getDb();
  const seg = getSegment(db, id);
  if (!seg || seg.owner !== auth.email) return NextResponse.json({ error: "Segmento non trovato" }, { status: 404 });
  deleteSegment(db, id);
  return NextResponse.json({ ok: true });
}
