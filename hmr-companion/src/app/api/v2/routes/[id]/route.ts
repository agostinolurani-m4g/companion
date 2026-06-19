import { NextResponse } from "next/server";
import { normalizeUsername, requireV2Beta } from "@/lib/auth";
import {
  deleteUserRoute,
  getUserRoute,
  updateUserRoute,
  type UserRouteActivity,
  type UserRouteVisibility,
} from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const VALID_ACTIVITIES = new Set<UserRouteActivity>(["road", "mtb", "hike"]);
const VALID_VISIBILITY = new Set<UserRouteVisibility>(["private", "public"]);

function canReadRoute(route: NonNullable<ReturnType<typeof getUserRoute>>, username: string): boolean {
  return route.owner === normalizeUsername(username) || route.visibility === "public";
}

function serializeRoute(row: NonNullable<ReturnType<typeof getUserRoute>>) {
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

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const route = getUserRoute(id);
  if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  if (!canReadRoute(route, auth.email)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  return NextResponse.json({ route: serializeRoute(route) });
}

type PatchBody = {
  name?: string;
  activity?: UserRouteActivity;
  geojson?: GeoJSON.Feature<GeoJSON.LineString>;
  waypoints?: [number, number][];
  length_km?: number;
  elev_gain_m?: number;
  elev_loss_m?: number;
  visibility?: UserRouteVisibility;
};

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const route = getUserRoute(id);
  if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  if (route.owner !== normalizeUsername(auth.email)) {
    return NextResponse.json({ error: "Solo il proprietario può modificare" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  if (body.activity && !VALID_ACTIVITIES.has(body.activity)) {
    return NextResponse.json({ error: "activity non valida" }, { status: 400 });
  }
  if (body.visibility && !VALID_VISIBILITY.has(body.visibility)) {
    return NextResponse.json({ error: "visibility non valida" }, { status: 400 });
  }

  updateUserRoute(id, {
    name: body.name?.trim() || undefined,
    activity: body.activity,
    geojson: body.geojson ? JSON.stringify(body.geojson) : undefined,
    waypoints_json: body.waypoints ? JSON.stringify(body.waypoints) : undefined,
    length_km: body.length_km,
    elev_gain_m: body.elev_gain_m,
    elev_loss_m: body.elev_loss_m,
    visibility: body.visibility,
    updated_at: Date.now(),
  });

  const updated = getUserRoute(id);
  return NextResponse.json({ ok: true, route: updated ? serializeRoute(updated) : null });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const route = getUserRoute(id);
  if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  if (route.owner !== normalizeUsername(auth.email)) {
    return NextResponse.json({ error: "Solo il proprietario può eliminare" }, { status: 403 });
  }

  deleteUserRoute(id);
  return NextResponse.json({ ok: true });
}
