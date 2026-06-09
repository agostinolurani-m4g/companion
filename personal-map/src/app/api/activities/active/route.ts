import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getActiveRecordingForOwner } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const active = getActiveRecordingForOwner(auth.email);
  if (!active) return NextResponse.json({ activity: null });

  let points: unknown[] = [];
  try {
    points = JSON.parse(active.points_json) as unknown[];
  } catch {
    points = [];
  }

  return NextResponse.json({
    activity: {
      id: active.id,
      name: active.name,
      activity_type: active.activity_type,
      started_at: active.started_at,
      point_count: points.length,
      points,
    },
  });
}
