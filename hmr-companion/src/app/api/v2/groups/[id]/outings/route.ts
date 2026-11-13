import { NextResponse } from "next/server";
import { normalizeUsername, requireV2Beta } from "@/lib/auth";
import { getGroup, getGroupMember, getUserRoute, listOutingsForGroup, type UserRouteRow } from "@/lib/db";
import { serializeOutings } from "@/lib/outings";
import type { UserRouteActivity } from "@/lib/sports";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Traccia usata dal gruppo: quella collegata al gruppo o quella di una sua gita. */
export type GroupRouteDto = {
  id: string;
  name: string;
  owner: string;
  activity: UserRouteActivity;
  length_km: number;
  elev_gain_m: number;
  /** Collegata al gruppo nelle impostazioni. */
  linked: boolean;
  planned_count: number;
  done_count: number;
  /** Chi guarda può aprire la traccia nel planner e pianificarci una gita (sua o pubblica). */
  can_open: boolean;
  /** Gita più recente su questa traccia: da lì la traccia si vede anche se privata. */
  latest_outing_id: string | null;
};

/** Gite del gruppo e tracce su cui si svolgono: due elenchi distinti. */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  if (!getGroupMember(id, auth.email)) {
    return NextResponse.json({ error: "Non sei membro" }, { status: 403 });
  }

  const me = normalizeUsername(auth.email);
  const rows = listOutingsForGroup(id);
  const outings = serializeOutings(rows);

  const routes = new Map<string, GroupRouteDto>();
  const add = (route: UserRouteRow | undefined, linked: boolean): GroupRouteDto | null => {
    if (!route) return null;
    let dto = routes.get(route.id);
    if (!dto) {
      dto = {
        id: route.id,
        name: route.name,
        owner: route.owner,
        activity: route.activity,
        length_km: route.length_km,
        elev_gain_m: route.elev_gain_m,
        linked: false,
        planned_count: 0,
        done_count: 0,
        can_open: route.owner === me || route.visibility === "public",
        latest_outing_id: null,
      };
      routes.set(route.id, dto);
    }
    if (linked) dto.linked = true;
    return dto;
  };

  const linkedRouteId = getGroup(id)?.route_id;
  if (linkedRouteId) add(getUserRoute(linkedRouteId), true);
  // `rows` è ordinato dalla gita più recente.
  for (const o of rows) {
    const dto = add(getUserRoute(o.route_id), false);
    if (!dto) continue;
    if (o.status === "planned") dto.planned_count++;
    else dto.done_count++;
    dto.latest_outing_id ??= o.id;
  }

  return NextResponse.json({ outings, routes: [...routes.values()] });
}
