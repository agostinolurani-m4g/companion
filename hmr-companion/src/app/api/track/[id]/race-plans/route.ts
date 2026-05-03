import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  getTrack,
  insertRacePlan,
  listRacePlansWithItems,
  type RacePlanWithItems,
} from "@/lib/db";
import { requireAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id: trackId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  const racePlans: RacePlanWithItems[] = listRacePlansWithItems(trackId);
  return NextResponse.json({ racePlans, length_km: track.length_km });
}

type PostBody = { name?: string };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id: trackId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as PostBody;
  const name = body.name?.trim() || "Nuovo piano";
  const now = Date.now();
  const id = crypto.randomUUID();
  insertRacePlan({ id, track_id: trackId, name, created_at: now, updated_at: now });
  const plan: RacePlanWithItems = {
    id,
    track_id: trackId,
    name,
    created_at: now,
    updated_at: now,
    items: [],
  };
  return NextResponse.json({ plan });
}
