import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { serializeActivity } from "@/lib/activities/serialize";
import { listActivities, type ActivityReviewState } from "@/lib/activities/store";

export const runtime = "nodejs";

const REVIEW_STATES = new Set<ActivityReviewState>(["pending", "done", "dismissed"]);

/** Attività importate dell'utente corrente. `?review=pending&geo=1&limit=20` */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const url = new URL(req.url);
  const review = url.searchParams.get("review") as ActivityReviewState | null;
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const rows = listActivities(getDb(), auth.email, {
    reviewState: review && REVIEW_STATES.has(review) ? review : undefined,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  const geometry = url.searchParams.get("geo") === "1";
  return NextResponse.json({ activities: rows.map((r) => serializeActivity(r, { geometry })) });
}
