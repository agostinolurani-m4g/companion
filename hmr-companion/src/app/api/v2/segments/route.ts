import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { lineLengthM } from "@/lib/segments/match";
import { serializeSegment } from "@/lib/segments/serialize";
import {
  insertSegment,
  listSegmentsForUser,
  listSegmentsInBbox,
  matchSegmentAgainstActivities,
  type SegmentVisibility,
} from "@/lib/segments/store";
import { USER_ROUTE_ACTIVITIES } from "@/lib/sports";

export const runtime = "nodejs";

const SPORTS = new Set<string>(USER_ROUTE_ACTIVITIES);

/** GET ?bbox=south,west,north,east[&sport=] → segmenti visibili nell'area; senza bbox → i miei. */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const url = new URL(req.url);
  const db = getDb();
  const bbox = url.searchParams.get("bbox");
  const sport = url.searchParams.get("sport") ?? undefined;
  const kindRaw = url.searchParams.get("kind");
  const kind = kindRaw === "climb" || kindRaw === "descent" || kindRaw === "flat" ? kindRaw : undefined;
  const geometry = url.searchParams.get("geometry") !== "0";
  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return NextResponse.json({ error: "bbox non valido (south,west,north,east)" }, { status: 400 });
    }
    const [south, west, north, east] = parts;
    const rows = listSegmentsInBbox(db, auth.email, { south, west, north, east }, { sport: sport && SPORTS.has(sport) ? sport : undefined, kind });
    return NextResponse.json({ segments: rows.map((r) => serializeSegment(r, { geometry })) });
  }
  return NextResponse.json({ segments: listSegmentsForUser(db, auth.email).map((r) => serializeSegment(r, { geometry })) });
}

type PostBody = {
  name?: string;
  sport?: string;
  coords?: unknown;
  visibility?: SegmentVisibility;
  source_kind?: "activity" | "route" | "draw";
  source_id?: string;
};

function validCoords(raw: unknown): GeoJSON.Position[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 5000) return null;
  const out: GeoJSON.Position[] = [];
  for (const c of raw) {
    if (!Array.isArray(c) || c.length < 2) return null;
    const [lng, lat, ele] = c as number[];
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    out.push(Number.isFinite(ele) ? [lng, lat, Math.round(ele)] : [lng, lat]);
  }
  return out;
}

/** Crea un segmento e cerca subito i passaggi su tutte le attività note. */
export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as PostBody;
  const name = (body.name ?? "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "Dai un nome al segmento" }, { status: 400 });
  const sport = body.sport && SPORTS.has(body.sport) ? body.sport : null;
  if (!sport) return NextResponse.json({ error: "Sport non valido" }, { status: 400 });
  const coords = validCoords(body.coords);
  if (!coords) return NextResponse.json({ error: "Geometria non valida" }, { status: 400 });
  const len = lineLengthM(coords);
  if (len < 200) return NextResponse.json({ error: "Segmento troppo corto (min 200 m)" }, { status: 400 });
  if (len > 60_000) return NextResponse.json({ error: "Segmento troppo lungo (max 60 km)" }, { status: 400 });
  const db = getDb();
  const now = Date.now();
  const seg = insertSegment(db, {
    owner: auth.email,
    name,
    sport,
    coords,
    visibility: body.visibility === "private" ? "private" : "public",
    source_kind: body.source_kind ?? null,
    source_id: body.source_id ?? null,
    now,
  });
  const efforts = matchSegmentAgainstActivities(db, seg, now);
  return NextResponse.json({ segment: serializeSegment(seg, { geometry: true }), efforts }, { status: 201 });
}
