import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { featuresAlongRoute, bboxAroundRoute } from "@/lib/outdoor/along";
import { kindLabel } from "@/lib/outdoor/kinds";
import { ON_ROUTE_MAX_M, ON_ROUTE_ONLY_KINDS, START_MAX_M, START_ONLY_KINDS } from "@/lib/outdoor/plan-relevance";
import { queryOutdoorFeaturesInBbox } from "@/lib/outdoor/store";

export const runtime = "nodejs";

type Body = {
  coordinates?: [number, number][];
  maxDistM?: number;
  sport?: string;
};

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json()) as Body;
  const coords = body.coordinates ?? [];
  if (coords.length < 2) {
    return NextResponse.json({ error: "coordinates richieste" }, { status: 400 });
  }
  const maxDistM = body.maxDistM ?? 150;

  const db = getDb();
  const bbox = bboxAroundRoute(coords, maxDistM + 50);
  const rows = queryOutdoorFeaturesInBbox(db, {
    ...bbox,
    zoom: 14,
    sport: null,
    limit: 5000,
  });
  // Cancelli solo se sul tracciato; parcheggi/stazioni solo nella zona di partenza.
  const hits = featuresAlongRoute(coords, rows, maxDistM).filter((h) => {
    if (ON_ROUTE_ONLY_KINDS.has(h.feature.kind)) return h.distM <= ON_ROUTE_MAX_M;
    if (START_ONLY_KINDS.has(h.feature.kind)) return h.alongKm * 1000 <= START_MAX_M;
    return true;
  });

  return NextResponse.json({
    items: hits.map((h) => ({
      id: h.feature.id,
      name: h.feature.name,
      kind: h.feature.kind,
      kindLabel: kindLabel(h.feature.kind),
      grp: h.feature.grp,
      lat: h.feature.lat,
      lng: h.feature.lng,
      alongKm: h.alongKm,
      distM: Math.round(h.distM),
    })),
  });
}
