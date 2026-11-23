import { NextResponse } from "next/server";
import { parseAlongBody } from "@/lib/along-route-body";
import { requireV2Beta } from "@/lib/auth";
import { listUserPhotosInBbox } from "@/lib/db";
import { pointsAlongRoute, routeBbox } from "@/lib/geo-along";
import { avatarUrl } from "@/lib/social-labels";

export const runtime = "nodejs";

/** POST { coordinates, maxDistM? (default 300) } → foto della community vicino al percorso, in ordine di km. */
export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const parsed = parseAlongBody(await req.json().catch(() => null), { maxDistM: 300, maxCap: 1000 });
  if (!parsed) return NextResponse.json({ error: "Percorso non valido" }, { status: 400 });
  const [south, west, north, east] = routeBbox(parsed.route, parsed.maxDistM);
  const rows = listUserPhotosInBbox(south, west, north, east, 2000);
  const hits = pointsAlongRoute(parsed.route, rows, parsed.maxDistM).slice(0, 80);
  return NextResponse.json({
    photos: hits.map((h) => ({
      id: h.item.id,
      owner: h.item.owner,
      lng: h.item.lng,
      lat: h.item.lat,
      caption: h.item.caption,
      url: avatarUrl(h.item.photo_path),
      created_at: h.item.created_at,
      along_km: h.alongKm,
      dist_m: h.distM,
    })),
  });
}
