import { NextResponse } from "next/server";
import { normalizeUsername, requireV2Beta } from "@/lib/auth";
import {
  canViewOuting,
  deleteOuting,
  getDb,
  getOuting,
  getUserRoute,
  listOutingParticipants,
  updateOuting,
} from "@/lib/db";
import { serializeOuting } from "@/lib/outings";
import { applyOutingRelations, outingPatchFromBody, type OutingBody } from "@/lib/outings-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Gita + traccia (geometria inclusa se il percorso è leggibile). */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const outing = getOuting(id);
  if (!outing) return NextResponse.json({ error: "Gita non trovata" }, { status: 404 });
  if (!canViewOuting(id, auth.email)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const me = normalizeUsername(auth.email);
  const route = getUserRoute(outing.route_id);
  // Chi partecipa alla gita vede la traccia anche se privata: serve per andarci.
  const routeDto = route
    ? {
        id: route.id,
        name: route.name,
        owner: route.owner,
        activity: route.activity,
        visibility: route.visibility,
        length_km: route.length_km,
        elev_gain_m: route.elev_gain_m,
        elev_loss_m: route.elev_loss_m,
        geojson: JSON.parse(route.geojson) as unknown,
      }
    : null;

  return NextResponse.json({
    outing: serializeOuting(outing),
    route: routeDto,
    can_edit: outing.owner === me,
    can_add_photos: outing.owner === me || listOutingParticipants(id).includes(me),
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const outing = getOuting(id);
  if (!outing) return NextResponse.json({ error: "Gita non trovata" }, { status: 404 });
  if (outing.owner !== normalizeUsername(auth.email)) {
    return NextResponse.json({ error: "Solo chi ha creato la gita può modificarla" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as OutingBody;
  const patch = outingPatchFromBody(body);
  getDb().transaction(() => {
    updateOuting(id, patch);
    applyOutingRelations(id, auth.email, body);
  })();

  return NextResponse.json({ outing: serializeOuting(getOuting(id)!) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const outing = getOuting(id);
  if (!outing) return NextResponse.json({ error: "Gita non trovata" }, { status: 404 });
  if (outing.owner !== normalizeUsername(auth.email)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  deleteOuting(id);
  return NextResponse.json({ ok: true });
}
