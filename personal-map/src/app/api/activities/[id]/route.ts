import fs from "node:fs";
import path from "node:path";
import type { Position } from "geojson";
import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import type { RecordedPoint } from "@/lib/activity-points";
import {
  appendActivityPoints,
  completeActivity,
  discardActivity,
  getActivityForOwner,
} from "@/lib/db";
import { recordedPointsToGpx } from "@/lib/gpx";
import {
  ingestPositionsToDb,
  resolveUniqueTrackId,
  trackExists,
} from "@/lib/track-ingest";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await ctx.params;
  const activity = getActivityForOwner(id, auth.email);
  if (!activity) return NextResponse.json({ error: "Activity non trovata" }, { status: 404 });

  let points: unknown[] = [];
  try {
    points = JSON.parse(activity.points_json) as unknown[];
  } catch {
    points = [];
  }

  return NextResponse.json({ ...activity, points });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await ctx.params;
  const activity = getActivityForOwner(id, auth.email);
  if (!activity) return NextResponse.json({ error: "Activity non trovata" }, { status: 404 });

  const body = (await req.json()) as {
    points?: RecordedPoint[];
    action?: "stop" | "discard";
  };

  if (body.action === "discard") {
    discardActivity(id, auth.email);
    return NextResponse.json({ ok: true, status: "discarded" });
  }

  if (body.points?.length) {
    appendActivityPoints(id, auth.email, body.points);
  }

  if (body.action === "stop") {
    const fresh = getActivityForOwner(id, auth.email);
    if (!fresh) return NextResponse.json({ error: "Activity non trovata" }, { status: 404 });

    let recorded: RecordedPoint[] = [];
    try {
      recorded = JSON.parse(fresh.points_json) as RecordedPoint[];
    } catch {
      recorded = [];
    }

    if (recorded.length < 2) {
      return NextResponse.json({ error: "Servono almeno 2 punti GPS" }, { status: 400 });
    }

    const name = fresh.name ?? `Registrazione ${new Date().toLocaleDateString("it-IT")}`;
    const baseId = resolveUniqueTrackId(name, trackExists);
    const gpxRel = path.join("data", "uploads", "recordings", `${id}.gpx`);
    const gpxAbs = path.join(process.cwd(), gpxRel);
    fs.mkdirSync(path.dirname(gpxAbs), { recursive: true });
    fs.writeFileSync(gpxAbs, recordedPointsToGpx(name, recorded), "utf8");

    const positions: Position[] = recorded.map((p) => {
      const c: Position = [p.lng, p.lat];
      if (p.eleM != null && Number.isFinite(p.eleM)) c.push(p.eleM);
      return c;
    });

    const result = ingestPositionsToDb({
      positions,
      trackId: baseId,
      name,
      ownerId: auth.email,
      gpxRelPath: gpxRel.replace(/\\/g, "/"),
      activityType: fresh.activity_type,
      source: "gps_record",
    });

    const endedAt = Date.now();
    completeActivity(id, auth.email, result.trackId, endedAt);

    return NextResponse.json({
      activityId: id,
      trackId: result.trackId,
      length_km: result.length_km,
      elev_gain_m: result.elev_gain_m,
    });
  }

  return NextResponse.json({ ok: true });
}
