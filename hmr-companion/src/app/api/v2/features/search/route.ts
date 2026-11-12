import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { kindLabel } from "@/lib/outdoor/kinds";
import { getOutdoorFeatureById, searchOutdoorFeatures } from "@/lib/outdoor/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const db = getDb();
  const hits = searchOutdoorFeatures(db, q, 20);
  const results = hits
    .map((h) => {
      const row = getOutdoorFeatureById(db, h.feature_id);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        kindLabel: kindLabel(row.kind),
        lat: row.lat,
        lng: row.lng,
        ele: row.ele,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ results });
}
