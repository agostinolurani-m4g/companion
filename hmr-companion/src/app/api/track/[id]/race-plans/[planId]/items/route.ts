import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  getRacePlan,
  getTrack,
  insertRacePlanItem,
  listRacePlanItems,
  normalizeRacePlanKms,
} from "@/lib/db";
import { RACE_PLAN_ITEM_KINDS, type RacePlanItemKind } from "@/lib/race-plan-types";
import { requireAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; planId: string }> };

function guardPlan(trackId: string, planId: string) {
  const plan = getRacePlan(planId);
  if (!plan) return { error: "Piano non trovato" as const, status: 404 as const };
  if (plan.track_id !== trackId) return { error: "Piano non appartiene a questa traccia" as const, status: 403 as const };
  return { plan };
}

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id: trackId, planId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  const g = guardPlan(trackId, planId);
  if ("error" in g && g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  const items = listRacePlanItems(planId);
  return NextResponse.json({ items });
}

type PostBody = {
  km_start?: number;
  km_end?: number;
  kind?: string;
  title?: string;
  body?: string;
  est_hours?: number | null | string;
  avoid_night?: boolean | number;
};

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id: trackId, planId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  const g = guardPlan(trackId, planId);
  if ("error" in g && g.error) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const kind = body.kind as RacePlanItemKind | undefined;
  if (!kind || !(RACE_PLAN_ITEM_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "kind non valido" }, { status: 400 });
  }
  const kmStart = typeof body.km_start === "number" ? body.km_start : 0;
  const kmEnd = typeof body.km_end === "number" ? body.km_end : kmStart;
  const { km_start, km_end } = normalizeRacePlanKms(kmStart, kmEnd, track.length_km);
  const title = body.title?.trim() ?? "";
  const notes = body.body?.trim() ?? "";
  let est_hours: number | null = null;
  if (body.est_hours != null && body.est_hours !== "") {
    const h = typeof body.est_hours === "number" ? body.est_hours : Number(body.est_hours);
    if (Number.isFinite(h) && h >= 0) est_hours = h;
  }
  const avoid_night: 0 | 1 =
    body.avoid_night === true || body.avoid_night === 1 ? 1 : 0;
  const now = Date.now();
  const id = crypto.randomUUID();
  insertRacePlanItem({
    id,
    plan_id: planId,
    km_start,
    km_end,
    kind,
    title,
    body: notes,
    est_hours,
    avoid_night,
    created_at: now,
    updated_at: now,
  });
  const items = listRacePlanItems(planId);
  const item = items.find((i) => i.id === id);
  return NextResponse.json({ item });
}
