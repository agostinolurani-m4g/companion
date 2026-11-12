import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { removeActivityHeat, syncActivityHeat } from "@/lib/activities/heatmap";
import { serializeActivity } from "@/lib/activities/serialize";
import {
  deleteActivityRow,
  getActivity,
  setActivityCommunityConsent,
  setActivityReviewState,
  type ActivityReviewState,
} from "@/lib/activities/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const REVIEW_STATES = new Set<ActivityReviewState>(["pending", "done", "dismissed"]);

async function ownActivity(id: string) {
  const auth = await requireV2Beta();
  if (!auth) return { error: NextResponse.json({ error: "Non autorizzato" }, { status: 403 }) } as const;
  const db = getDb();
  const row = getActivity(db, id);
  if (!row || row.owner !== auth.email) {
    return { error: NextResponse.json({ error: "Attività non trovata" }, { status: 404 }) } as const;
  }
  return { db, row } as const;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const r = await ownActivity(id);
  if ("error" in r) return r.error;
  return NextResponse.json({ activity: serializeActivity(r.row, { geometry: true }) });
}

type PatchBody = { review_state?: ActivityReviewState; community_consent?: boolean };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const r = await ownActivity(id);
  if ("error" in r) return r.error;
  const body = (await req.json().catch(() => ({}))) as PatchBody;
  if (body.review_state !== undefined) {
    if (!REVIEW_STATES.has(body.review_state)) {
      return NextResponse.json({ error: "review_state non valido" }, { status: 400 });
    }
    setActivityReviewState(r.db, id, body.review_state);
  }
  if (body.community_consent !== undefined) {
    setActivityCommunityConsent(r.db, id, !!body.community_consent);
    const updated = getActivity(r.db, id);
    if (updated) syncActivityHeat(r.db, updated);
  }
  const fresh = getActivity(r.db, id)!;
  return NextResponse.json({ activity: serializeActivity(fresh) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const r = await ownActivity(id);
  if ("error" in r) return r.error;
  removeActivityHeat(r.db, r.row);
  deleteActivityRow(r.db, id);
  return NextResponse.json({ ok: true });
}
