import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isKnownHmrUser, normalizeUsername, requireV2Beta } from "@/lib/auth";
import {
  addOutingGroup,
  addOutingParticipant,
  canViewOuting,
  getGroupMember,
  getUserRoute,
  insertOuting,
  listOutingsVisibleForRoute,
  listOutingsVisibleForUser,
  updateUserRoute,
} from "@/lib/db";
import { serializeOutings } from "@/lib/outings";

export const runtime = "nodejs";

type PostBody = {
  route_id?: string;
  title?: string;
  outing_date?: string | null;
  notes?: string;
  snow_notes?: string;
  participants?: string[];
  group_ids?: string[];
  make_route_public?: boolean;
};

export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const routeId = (url.searchParams.get("route_id") ?? "").trim();
  const scope = url.searchParams.get("scope") ?? "";

  if (routeId) {
    const route = getUserRoute(routeId);
    if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
    const canReadRoute =
      route.owner === normalizeUsername(auth.email) || route.visibility === "public";
    if (!canReadRoute) {
      return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
    }
    const rows = listOutingsVisibleForRoute(routeId, auth.email);
    return NextResponse.json({ route_id: routeId, outings: serializeOutings(rows) });
  }

  if (scope === "mine") {
    const rows = listOutingsVisibleForUser(auth.email);
    return NextResponse.json({ scope: "mine", outings: serializeOutings(rows) });
  }

  return NextResponse.json(
    { error: "Specificare route_id o scope=mine" },
    { status: 400 },
  );
}

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const routeId = (body.route_id ?? "").trim();
  if (!routeId) return NextResponse.json({ error: "route_id richiesto" }, { status: 400 });

  const route = getUserRoute(routeId);
  if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });

  if (body.make_route_public !== false && route.visibility !== "public") {
    updateUserRoute(routeId, { visibility: "public", updated_at: Date.now() });
  }

  const now = Date.now();
  const outingId = crypto.randomUUID();
  const title = (body.title ?? route.name).trim() || route.name;
  const notes = (body.notes ?? body.snow_notes ?? "").trim();

  insertOuting({
    id: outingId,
    route_id: routeId,
    owner: auth.email,
    title,
    outing_date: body.outing_date ?? null,
    notes,
    created_at: now,
    updated_at: now,
  });

  addOutingParticipant(outingId, auth.email);

  const participants = new Set<string>([auth.email]);
  for (const raw of body.participants ?? []) {
    const u = raw.trim().toLowerCase();
    if (!u || participants.has(u)) continue;
    if (!isKnownHmrUser(u)) continue;
    addOutingParticipant(outingId, u);
    participants.add(u);
  }

  for (const groupId of body.group_ids ?? []) {
    const gid = groupId.trim();
    if (!gid) continue;
    if (!getGroupMember(gid, auth.email)) continue;
    addOutingGroup(outingId, gid);
  }

  return NextResponse.json(
    {
      id: outingId,
      route_id: routeId,
      title,
      outing_date: body.outing_date ?? null,
      notes,
      activity: route.activity,
    },
    { status: 201 },
  );
}
