import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import {
  createActivity,
  getActiveRecordingForOwner,
  listActivities,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  return NextResponse.json({ activities: listActivities(auth.email) });
}

export async function POST(req: Request) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const active = getActiveRecordingForOwner(auth.email);
  if (active) {
    return NextResponse.json({ error: "Registrazione già attiva", activityId: active.id }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    activityType?: string;
  };

  const now = Date.now();
  const id = crypto.randomUUID();
  createActivity({
    id,
    owner_id: auth.email,
    name: body.name ?? `Registrazione ${new Date(now).toLocaleDateString("it-IT")}`,
    activity_type: body.activityType ?? null,
    started_at: now,
    created_at: now,
  });

  return NextResponse.json({ activityId: id, started_at: now }, { status: 201 });
}
