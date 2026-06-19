import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  insertUserRoute,
  listPublicRoutes,
  listRoutesForOwner,
  type UserRouteActivity,
  type UserRouteVisibility,
} from "@/lib/db";

export const runtime = "nodejs";

const VALID_ACTIVITIES = new Set<UserRouteActivity>(["road", "mtb", "hike"]);
const VALID_VISIBILITY = new Set<UserRouteVisibility>(["private", "public"]);

function serializeRoute(row: ReturnType<typeof listRoutesForOwner>[number]) {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    activity: row.activity,
    geojson: JSON.parse(row.geojson) as GeoJSON.Feature<GeoJSON.LineString>,
    waypoints: JSON.parse(row.waypoints_json) as [number, number][],
    length_km: row.length_km,
    elev_gain_m: row.elev_gain_m,
    elev_loss_m: row.elev_loss_m,
    visibility: row.visibility,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "mine";

  if (scope === "public") {
    return NextResponse.json({
      routes: listPublicRoutes().map(serializeRoute),
    });
  }

  return NextResponse.json({
    routes: listRoutesForOwner(auth.email).map(serializeRoute),
  });
}

type PostBody = {
  name?: string;
  activity?: UserRouteActivity;
  geojson?: GeoJSON.Feature<GeoJSON.LineString>;
  waypoints?: [number, number][];
  length_km?: number;
  elev_gain_m?: number;
  elev_loss_m?: number;
  visibility?: UserRouteVisibility;
};

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const name = (body.name ?? "").trim() || "Percorso senza nome";
  const activity = body.activity ?? "hike";
  if (!VALID_ACTIVITIES.has(activity)) {
    return NextResponse.json({ error: "activity non valida" }, { status: 400 });
  }
  const visibility = body.visibility ?? "private";
  if (!VALID_VISIBILITY.has(visibility)) {
    return NextResponse.json({ error: "visibility non valida" }, { status: 400 });
  }
  if (!body.geojson?.geometry || body.geojson.geometry.type !== "LineString") {
    return NextResponse.json({ error: "geojson LineString richiesto" }, { status: 400 });
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  insertUserRoute({
    id,
    owner: auth.email,
    name,
    activity,
    geojson: JSON.stringify(body.geojson),
    waypoints_json: JSON.stringify(body.waypoints ?? []),
    length_km: typeof body.length_km === "number" ? body.length_km : 0,
    elev_gain_m: typeof body.elev_gain_m === "number" ? body.elev_gain_m : 0,
    elev_loss_m: typeof body.elev_loss_m === "number" ? body.elev_loss_m : 0,
    visibility,
    created_at: now,
    updated_at: now,
  });

  return NextResponse.json({ ok: true, id });
}
