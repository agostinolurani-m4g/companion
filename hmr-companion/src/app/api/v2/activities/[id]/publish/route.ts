import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb, insertUserRoute, type UserRouteVisibility } from "@/lib/db";
import { computeTrackStats } from "@/lib/activities/parse-files";
import { getActivity, parseActivityLine, setActivityReviewState } from "@/lib/activities/store";
import { isUserRouteActivity } from "@/lib/sports";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type Body = { name?: string; visibility?: UserRouteVisibility };

/** Trasforma un'attività importata da file in un percorso (privato o pubblico). */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const { id } = await ctx.params;
  const db = getDb();
  const row = getActivity(db, id);
  if (!row || row.owner !== auth.email) return NextResponse.json({ error: "Attività non trovata" }, { status: 404 });
  if (row.provider === "strava") {
    return NextResponse.json(
      { error: "Le attività Strava non possono essere pubblicate: carica il GPX originale se vuoi condividerla." },
      { status: 400 },
    );
  }
  if (!isUserRouteActivity(row.sport)) return NextResponse.json({ error: "Sport non supportato" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const visibility: UserRouteVisibility = body.visibility === "public" ? "public" : "private";
  const line = parseActivityLine(row);
  const pts = line.coordinates.map((c) => ({ lng: c[0], lat: c[1], ele: c[2] }));
  const loss = computeTrackStats([...pts].reverse()).elev_gain_m;
  const now = Date.now();
  const routeId = crypto.randomUUID();
  insertUserRoute({
    id: routeId,
    owner: auth.email,
    name: (body.name ?? "").trim() || row.name || "Percorso importato",
    activity: row.sport,
    geojson: JSON.stringify({ type: "Feature", properties: {}, geometry: line }),
    waypoints_json: JSON.stringify([line.coordinates[0].slice(0, 2), line.coordinates[line.coordinates.length - 1].slice(0, 2)]),
    length_km: Math.round(row.distance_m / 10) / 100,
    elev_gain_m: row.elev_gain_m,
    elev_loss_m: loss,
    visibility,
    source: "activity_import",
    external_id: row.id,
    meta_json: JSON.stringify({ activity_id: row.id, start_time: row.start_time }),
    created_at: now,
    updated_at: now,
  });
  setActivityReviewState(db, id, "done");
  return NextResponse.json({ ok: true, route_id: routeId });
}
