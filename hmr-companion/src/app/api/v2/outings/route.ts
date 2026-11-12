import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeUsername, requireV2Beta } from "@/lib/auth";
import {
  addOutingParticipant,
  getDb,
  getOuting,
  getUserRoute,
  insertOuting,
  listOutingsVisibleForRoute,
  listOutingsVisibleForUser,
  updateUserRoute,
} from "@/lib/db";
import { serializeOuting, serializeOutings } from "@/lib/outings";
import { applyOutingRelations, outingPatchFromBody, type OutingBody } from "@/lib/outings-server";

export const runtime = "nodejs";

type PostBody = OutingBody & {
  route_id?: string;
  /** Opt-in esplicito: registrare una gita non pubblica più il percorso. */
  make_route_public?: boolean;
};

export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const routeId = (url.searchParams.get("route_id") ?? "").trim();
  const scope = url.searchParams.get("scope") ?? "";
  const status = url.searchParams.get("status");
  const filter = <T extends { status: string }>(rows: T[]) =>
    status === "planned" || status === "done" ? rows.filter((r) => r.status === status) : rows;

  if (routeId) {
    const route = getUserRoute(routeId);
    if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
    const canReadRoute =
      route.owner === normalizeUsername(auth.email) || route.visibility === "public";
    if (!canReadRoute) {
      return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
    }
    const rows = filter(listOutingsVisibleForRoute(routeId, auth.email));
    return NextResponse.json({ route_id: routeId, outings: serializeOutings(rows) });
  }

  if (scope === "mine") {
    const rows = filter(listOutingsVisibleForUser(auth.email));
    return NextResponse.json({ scope: "mine", outings: serializeOutings(rows) });
  }

  return NextResponse.json({ error: "Specificare route_id o scope=mine" }, { status: 400 });
}

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const routeId = (body.route_id ?? "").trim();
  if (!routeId) return NextResponse.json({ error: "route_id richiesto" }, { status: 400 });

  const route = getUserRoute(routeId);
  if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  const me = normalizeUsername(auth.email);
  if (route.owner !== me && route.visibility !== "public") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const patch = outingPatchFromBody(body);
  const now = Date.now();
  const outingId = crypto.randomUUID();

  getDb().transaction(() => {
    if (body.make_route_public === true && route.owner === me && route.visibility !== "public") {
      updateUserRoute(routeId, { visibility: "public", updated_at: now });
    }
    insertOuting({
      id: outingId,
      route_id: routeId,
      owner: auth.email,
      title: patch.title ?? route.name,
      outing_date: patch.outing_date ?? null,
      start_time: patch.start_time ?? null,
      status: patch.status ?? "planned",
      visibility: patch.visibility ?? "participants",
      notes: patch.notes ?? "",
      story: patch.story ?? "",
      conditions_json: patch.conditions_json ?? null,
      created_at: now,
      updated_at: now,
    });
    addOutingParticipant(outingId, auth.email);
    applyOutingRelations(outingId, auth.email, body);
  })();

  return NextResponse.json({ outing: serializeOuting(getOuting(outingId)!), id: outingId }, { status: 201 });
}
