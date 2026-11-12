import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { fetchConditions, startAndSummit } from "@/lib/conditions";

export const runtime = "nodejs";

function num(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET `?lat=&lng=` (compatibile) con opzionali `start_ele`, `summit_lat`, `summit_lng`,
 * `summit_ele`, `activity` (attiva zero termico/neve/vento in quota per gli sport invernali).
 */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const lat = num(url, "lat");
  const lng = num(url, "lng");
  if (lat == null || lng == null) {
    return NextResponse.json({ error: "lat e lng richiesti" }, { status: 400 });
  }
  const sLat = num(url, "summit_lat");
  const sLng = num(url, "summit_lng");
  const sEle = num(url, "summit_ele");

  try {
    const conditions = await fetchConditions({
      lat,
      lng,
      startEle: num(url, "start_ele"),
      summit: sLat != null && sLng != null && sEle != null ? { lat: sLat, lng: sLng, ele: sEle } : null,
      activity: url.searchParams.get("activity"),
    });
    return NextResponse.json({ conditions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore condizioni";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

type PostBody = {
  /** `[lng, lat]` o `[lng, lat, quota]`. */
  coordinates?: number[][];
  activity?: string;
};

/** Meteo alla partenza e al punto più alto del percorso (se le coordinate hanno la quota). */
export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const coords = Array.isArray(body.coordinates) ? body.coordinates : [];
  const pts = coords.length >= 2 ? startAndSummit(coords) : null;
  if (!pts) {
    return NextResponse.json({ error: "coordinates richieste" }, { status: 400 });
  }
  try {
    const conditions = await fetchConditions({
      lat: pts.start.lat,
      lng: pts.start.lng,
      startEle: pts.start.ele,
      summit: pts.summit,
      activity: body.activity ?? null,
    });
    return NextResponse.json({ conditions, sample_index: 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore condizioni";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
