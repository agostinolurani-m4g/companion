import { NextResponse } from "next/server";
import { getFirstTrack } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const t = getFirstTrack();
  if (!t) {
    return NextResponse.json(
      { error: "Nessuna traccia in DB. Esegui `npm run seed` dal root di hmr-companion/." },
      { status: 404 }
    );
  }
  return NextResponse.json({
    id: t.id,
    name: t.name,
    length_km: t.length_km,
    elev_gain_m: t.elev_gain_m,
    elev_loss_m: t.elev_loss_m,
    elev_profile_gain_scale: Number(t.elev_profile_gain_scale ?? 1),
    elev_profile_loss_scale: Number(t.elev_profile_loss_scale ?? 1),
    bbox: JSON.parse(t.bbox_json),
    point_count: t.point_count,
  });
}
