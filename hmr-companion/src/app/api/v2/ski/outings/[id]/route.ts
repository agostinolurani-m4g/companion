import { NextResponse } from "next/server";
import { normalizeUsername, requireV2Beta } from "@/lib/auth";
import { canViewSkiOuting, getSkiOuting, getUserRoute } from "@/lib/db";
import { serializeSkiOuting } from "@/lib/ski-outings";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const outing = getSkiOuting(id);
  if (!outing) return NextResponse.json({ error: "Gita non trovata" }, { status: 404 });
  if (!canViewSkiOuting(id, auth.email)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const route = getUserRoute(outing.route_id);
  if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });

  const canReadRoute =
    route.owner === normalizeUsername(auth.email) || route.visibility === "public";
  if (!canReadRoute) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  return NextResponse.json({
    outing: serializeSkiOuting(outing),
    route: {
      id: route.id,
      name: route.name,
      owner: route.owner,
      length_km: route.length_km,
      elev_gain_m: route.elev_gain_m,
      elev_loss_m: route.elev_loss_m,
    },
  });
}
