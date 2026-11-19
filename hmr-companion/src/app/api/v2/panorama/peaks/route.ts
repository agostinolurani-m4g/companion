import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { geoCacheGet, geoCacheSet, getDb } from "@/lib/db";
import { queryOutdoorFeaturesInBbox } from "@/lib/outdoor/store";
import { fetchOverpassRawElements, toOsmNode } from "@/lib/overpass";
import type { PanoramaPeak } from "@/lib/panorama";

export const runtime = "nodejs";

const RADIUS_KM = 80;

function parseEle(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > -500 && n < 9000 ? Math.round(n) : null;
}

/**
 * Vette con nome entro ~80 km da un punto, per il panorama.
 * Prima il DB locale (outdoor_features), poi Overpass (cache 30 gg per cella di 0,25°).
 */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "lat/lng non validi" }, { status: 400 });
  }
  const cellLat = Math.round(lat * 4) / 4;
  const cellLng = Math.round(lng * 4) / 4;
  const dLat = RADIUS_KM / 111.32;
  const dLng = RADIUS_KM / (111.32 * Math.cos((cellLat * Math.PI) / 180));
  const bbox = { south: cellLat - dLat, north: cellLat + dLat, west: cellLng - dLng, east: cellLng + dLng };

  const byKey = new Map<string, PanoramaPeak>();
  const local = queryOutdoorFeaturesInBbox(getDb(), { ...bbox, kinds: ["peak"], zoom: 18, limit: 20_000 });
  for (const r of local) {
    if (!r.name) continue;
    byKey.set(`${r.osm_type}/${r.osm_id}`, { id: r.id, name: r.name, lat: r.lat, lng: r.lng, ele: r.ele ?? null });
  }

  const cacheKey = `harvest:panorama-peaks:v1:${cellLat}:${cellLng}`;
  let remote = geoCacheGet(cacheKey) as PanoramaPeak[] | null;
  if (!remote) {
    try {
      const q = `[out:json][timeout:60];node["natural"~"^(peak|volcano)$"]["name"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out body;`;
      const els = await fetchOverpassRawElements(q);
      remote = [];
      for (const el of els) {
        const nd = toOsmNode(el);
        if (!nd?.tags?.name || nd.lat == null || nd.lon == null) continue;
        remote.push({
          id: `node/${nd.id}`,
          name: nd.tags["name:it"] || nd.tags.name,
          lat: nd.lat,
          lng: nd.lon,
          ele: parseEle(nd.tags.ele),
        });
      }
      geoCacheSet(cacheKey, remote);
    } catch {
      remote = [];
    }
  }
  for (const p of remote) if (!byKey.has(p.id)) byKey.set(p.id, p);

  return NextResponse.json({ peaks: [...byKey.values()], radius_km: RADIUS_KM });
}
