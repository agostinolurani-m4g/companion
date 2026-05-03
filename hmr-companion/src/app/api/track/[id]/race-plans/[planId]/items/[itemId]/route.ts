import { NextResponse } from "next/server";
import {
  deleteRacePlanItem,
  getRacePlan,
  getRacePlanItem,
  getTrack,
  listRacePlanItems,
  normalizeRacePlanKms,
  updateRacePlanItem,
} from "@/lib/db";
import { RACE_PLAN_ITEM_KINDS, type RacePlanItemKind } from "@/lib/race-plan-types";
import { requireAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; planId: string; itemId: string }> };

function guardItem(trackId: string, planId: string, itemId: string) {
  const plan = getRacePlan(planId);
  if (!plan) return { error: "Piano non trovato" as const, status: 404 as const };
  if (plan.track_id !== trackId) return { error: "Piano non appartiene a questa traccia" as const, status: 403 as const };
  const item = getRacePlanItem(itemId);
  if (!item) return { error: "Voce non trovata" as const, status: 404 as const };
  if (item.plan_id !== planId) return { error: "Voce non appartiene al piano" as const, status: 403 as const };
  return { item };
}

type PatchBody = {
  km_start?: number;
  km_end?: number;
  kind?: string;
  title?: string;
  body?: string;
  est_hours?: number | null | string;
  avoid_night?: boolean | number;
};

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id: trackId, planId, itemId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  const g = guardItem(trackId, planId, itemId);
  if ("error" in g && g.error) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const prev = g.item!;
  const kind = (body.kind as RacePlanItemKind | undefined) ?? prev.kind;
  if (!(RACE_PLAN_ITEM_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "kind non valido" }, { status: 400 });
  }
  const kmStart = typeof body.km_start === "number" ? body.km_start : prev.km_start;
  const kmEnd = typeof body.km_end === "number" ? body.km_end : prev.km_end;
  const { km_start, km_end } = normalizeRacePlanKms(kmStart, kmEnd, track.length_km);
  const title = body.title !== undefined ? String(body.title).trim() : prev.title;
  const notes = body.body !== undefined ? String(body.body).trim() : prev.body;
  let est_hours: number | null = prev.est_hours;
  if ("est_hours" in body) {
    if (body.est_hours == null || body.est_hours === "") est_hours = null;
    else {
      const h = Number(body.est_hours);
      est_hours = Number.isFinite(h) && h >= 0 ? h : null;
    }
  }
  const avoid_night: 0 | 1 =
    body.avoid_night !== undefined
      ? body.avoid_night === true || body.avoid_night === 1
        ? 1
        : 0
      : (prev.avoid_night as 0 | 1);

  const now = Date.now();
  updateRacePlanItem(itemId, {
    km_start,
    km_end,
    kind,
    title,
    body: notes,
    est_hours,
    avoid_night,
    updated_at: now,
  });
  const item = listRacePlanItems(planId).find((i) => i.id === itemId);
  return NextResponse.json({ item });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id: trackId, planId, itemId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  const g = guardItem(trackId, planId, itemId);
  if ("error" in g && g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  deleteRacePlanItem(itemId);
  return NextResponse.json({ ok: true });
}
