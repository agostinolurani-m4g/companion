import { NextResponse } from "next/server";
import { parseAlongBody } from "@/lib/along-route-body";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { pointsAlongRoute, routeBbox } from "@/lib/geo-along";
import { serializeHighlight } from "@/lib/highlights/serialize";
import { listHighlightsInBbox } from "@/lib/highlights/store";
import { USER_ROUTE_ACTIVITIES } from "@/lib/sports";

export const runtime = "nodejs";

const SPORTS = new Set<string>(USER_ROUTE_ACTIVITIES);

/** POST { coordinates, maxDistM? (default 400), sport? } → highlights vicino al percorso, in ordine di km. */
export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const raw = (await req.json().catch(() => null)) as { sport?: unknown } | null;
  const parsed = parseAlongBody(raw, { maxDistM: 400, maxCap: 2000 });
  if (!parsed) return NextResponse.json({ error: "Percorso non valido" }, { status: 400 });
  const [south, west, north, east] = routeBbox(parsed.route, parsed.maxDistM);
  const sport = typeof raw?.sport === "string" && SPORTS.has(raw.sport) ? raw.sport : undefined;
  const rows = listHighlightsInBbox(getDb(), auth.email, { south, west, north, east }, { sport, limit: 1000 });
  const hits = pointsAlongRoute(parsed.route, rows, parsed.maxDistM).slice(0, 60);
  return NextResponse.json({
    items: hits.map((h) => ({ ...serializeHighlight(h.item, auth.email), along_km: h.alongKm, dist_m: h.distM })),
  });
}
