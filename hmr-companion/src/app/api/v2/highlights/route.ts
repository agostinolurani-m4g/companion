import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb, getUserPhoto } from "@/lib/db";
import { serializeHighlight } from "@/lib/highlights/serialize";
import { insertHighlight, listHighlightsInBbox } from "@/lib/highlights/store";
import { USER_ROUTE_ACTIVITIES } from "@/lib/sports";

export const runtime = "nodejs";

const SPORTS = new Set<string>(USER_ROUTE_ACTIVITIES);

/** GET ?bbox=south,west,north,east[&sport=] → highlights dell'area, i più consigliati prima. */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const url = new URL(req.url);
  const parts = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "bbox non valido (south,west,north,east)" }, { status: 400 });
  }
  const [south, west, north, east] = parts;
  const sport = url.searchParams.get("sport") ?? "";
  const rows = listHighlightsInBbox(getDb(), auth.email, { south, west, north, east }, { sport: SPORTS.has(sport) ? sport : undefined });
  return NextResponse.json({ highlights: rows.map((h) => serializeHighlight(h, auth.email)) });
}

type PostBody = { name?: string; tip?: string; sport?: string; lat?: number; lng?: number; photo_id?: string | null };

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as PostBody;
  const name = (b.name ?? "").trim().slice(0, 100);
  if (name.length < 3) return NextResponse.json({ error: "Dai un nome (almeno 3 caratteri)" }, { status: 400 });
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Posizione non valida" }, { status: 400 });
  }
  const sport = b.sport && SPORTS.has(b.sport) ? b.sport : "";
  const photo = b.photo_id ? getUserPhoto(b.photo_id) : undefined;
  if (b.photo_id && !photo) return NextResponse.json({ error: "Foto non trovata" }, { status: 400 });
  const row = insertHighlight(getDb(), {
    owner: auth.email,
    name,
    tip: (b.tip ?? "").trim().slice(0, 600),
    sport,
    lat,
    lng,
    photo_id: photo?.id ?? null,
    now: Date.now(),
  });
  return NextResponse.json({ highlight: serializeHighlight(row, auth.email, { photos: true }) }, { status: 201 });
}
