import { NextResponse } from "next/server";
import crypto from "node:crypto";
import type { Position } from "geojson";
import { getDb, getTrack, type PoiCategory, type PoiRow } from "@/lib/db";
import { parseGoogleMapsUrl, GmapsParseError } from "@/lib/gmaps-url";
import { nearestPointOnPolyline } from "@/lib/track-geometry";
import type { StoredCoord } from "@/lib/track-coords";

export const runtime = "nodejs";

const VALID_CATEGORIES: ReadonlyArray<PoiCategory> = [
  "water",
  "hut",
  "lodging",
  "shop",
  "restaurant",
  "pharmacy",
  "atm",
  "bus",
];

type Ctx = { params: Promise<{ id: string }> };

type CreateBody = {
  mapsUrl?: string;
  category?: string;
  name?: string;
  notes?: string;
  lat?: number;
  lng?: number;
};

export async function POST(req: Request, ctx: Ctx) {
  const { id: trackId } = await ctx.params;
  const track = getTrack(trackId);
  if (!track) {
    return NextResponse.json({ error: "track not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const { mapsUrl, category, name: overrideName, notes, lat: manualLat, lng: manualLng } = body;

  if (!category || !(VALID_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json(
      { error: "categoria non valida" },
      { status: 400 }
    );
  }

  let lat: number;
  let lng: number;
  let name: string | null = overrideName?.trim() ? overrideName.trim() : null;
  let website: string | null = null;

  const urlTrim = mapsUrl?.trim();
  if (urlTrim) {
    try {
      const p = await parseGoogleMapsUrl(urlTrim);
      lat = p.lat;
      lng = p.lng;
      if (!name && p.name) name = p.name;
      website = p.googleUrl;
    } catch (e) {
      const msg =
        e instanceof GmapsParseError ? e.message : "URL non valido";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } else if (
    typeof manualLat === "number" &&
    typeof manualLng === "number" &&
    Number.isFinite(manualLat) &&
    Number.isFinite(manualLng)
  ) {
    lat = manualLat;
    lng = manualLng;
  } else {
    return NextResponse.json(
      { error: "Serve un URL Google Maps oppure lat/lng" },
      { status: 400 }
    );
  }

  // Proiezione sulla traccia (uso cum stoccato, già calibrato sui 921.3 km reali)
  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  const positions: Position[] = coords.map((c) =>
    c[2] != null ? [c[0], c[1], c[2]] : [c[0], c[1]]
  );
  const cum = coords.map((c) => c[3]);
  const near = nearestPointOnPolyline(positions, [lng, lat], cum);
  if (!near) {
    return NextResponse.json(
      { error: "impossibile proiettare il punto sulla traccia" },
      { status: 500 }
    );
  }

  const alongKm = Number(near.alongKm.toFixed(3));
  const detourM = Math.round(near.distKm * 1000);
  const trackElevAtProjection = coords[near.segIndex][2];
  // elev_delta non calcolabile offline: lo lasciamo null (richiederebbe
  // un'API di elevation per il punto utente; gli altri POI OSM ce l'hanno
  // perché vengono interpolati con Overpass in ingest).
  void trackElevAtProjection;

  const poiId = `user-${crypto.randomUUID()}`;
  const now = Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO pois (id, track_id, category, sub_kind, name, lat, lng, along_km, detour_m, elev_delta_m, phone, website, opening_hours, description, image_url, osm_type, osm_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    poiId,
    trackId,
    category,
    "user",
    name,
    Number(lat.toFixed(6)),
    Number(lng.toFixed(6)),
    alongKm,
    detourM,
    null,
    null,
    website,
    null,
    notes?.trim() ? notes.trim() : null,
    null,
    "user",
    null,
    now
  );

  const row = db.prepare("SELECT * FROM pois WHERE id = ?").get(poiId) as PoiRow;
  return NextResponse.json({ poi: row });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id: trackId } = await ctx.params;
  const url = new URL(req.url);
  const poiId = url.searchParams.get("poiId");
  if (!poiId) {
    return NextResponse.json({ error: "poiId mancante" }, { status: 400 });
  }

  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM pois WHERE id = ? AND track_id = ? AND osm_type = 'user'`
    )
    .run(poiId, trackId);
  if (result.changes === 0) {
    return NextResponse.json(
      { error: "POI non trovato o non eliminabile" },
      { status: 404 }
    );
  }
  return NextResponse.json({ deleted: result.changes });
}
