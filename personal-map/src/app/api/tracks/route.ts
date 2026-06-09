import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { listTracks } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuthenticated();
  if (!auth) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const tracks = listTracks(auth.email).map((t) => ({
    id: t.id,
    name: t.name,
    length_km: t.length_km,
    elev_gain_m: t.elev_gain_m,
    elev_loss_m: t.elev_loss_m,
    point_count: t.point_count,
    activity_type: t.activity_type,
    source: t.source,
    created_at: t.created_at,
  }));

  return NextResponse.json({ tracks });
}
