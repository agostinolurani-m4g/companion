import { NextResponse } from "next/server";
import { deleteRacePlan, getRacePlan, getTrack, updateRacePlan } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; planId: string }> };

function assertPlanOnTrack(trackId: string, planId: string) {
  const plan = getRacePlan(planId);
  if (!plan) return { error: "Piano non trovato" as const, status: 404 as const };
  if (plan.track_id !== trackId) return { error: "Piano non appartiene a questa traccia" as const, status: 403 as const };
  return { plan };
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id: trackId, planId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  const check = assertPlanOnTrack(trackId, planId);
  if ("error" in check && check.error) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name richiesto" }, { status: 400 });
  const now = Date.now();
  updateRacePlan(planId, name, now);
  const plan = getRacePlan(planId)!;
  return NextResponse.json({ plan });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id: trackId, planId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  const check = assertPlanOnTrack(trackId, planId);
  if ("error" in check && check.error) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  deleteRacePlan(planId);
  return NextResponse.json({ ok: true });
}
