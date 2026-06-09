import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { listTracks } from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";

export const runtime = "nodejs";

const TRACK_COLORS = [
  "#38bdf8",
  "#4ade80",
  "#fb923c",
  "#a78bfa",
  "#f472b6",
  "#fde047",
  "#f87171",
  "#34d399",
];

export async function GET() {
  const auth = await requireAuthenticated();
  if (!auth) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const tracks = listTracks(auth.email);
  const features = tracks.map((t, i) => {
    const coords = JSON.parse(t.coords_json) as StoredCoord[];
    const lineCoords = coords.map((c) => [c[0], c[1]] as [number, number]);
    const bbox = JSON.parse(t.bbox_json) as {
      minLng: number;
      maxLng: number;
      minLat: number;
      maxLat: number;
    };
    return {
      type: "Feature" as const,
      id: t.id,
      properties: {
        id: t.id,
        name: t.name,
        length_km: t.length_km,
        elev_gain_m: t.elev_gain_m,
        activity_type: t.activity_type,
        color: TRACK_COLORS[i % TRACK_COLORS.length],
        created_at: t.created_at,
        bbox,
      },
      geometry: {
        type: "LineString" as const,
        coordinates: lineCoords,
      },
    };
  });

  return NextResponse.json({
    type: "FeatureCollection",
    features,
  });
}
