import { NextResponse } from "next/server";
import { getTrack } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const t = getTrack(id);
  if (!t) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  const bbox = JSON.parse(t.bbox_json);
  const coords = JSON.parse(t.coords_json);
  return NextResponse.json({
    id: t.id,
    name: t.name,
    length_km: t.length_km,
    elev_gain_m: t.elev_gain_m,
    elev_loss_m: t.elev_loss_m,
    elev_profile_gain_scale: Number(t.elev_profile_gain_scale ?? 1),
    elev_profile_loss_scale: Number(t.elev_profile_loss_scale ?? 1),
    point_count: t.point_count,
    bbox,
    coords,
  });
}
