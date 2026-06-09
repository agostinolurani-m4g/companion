import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import {
  getTrack,
  getTrackForOwner,
  insertGeoHazardReport,
  type HazardKind,
} from "@/lib/db";
import { geohashCellId, HAZARD_CONSENSUS_THRESHOLD } from "@/lib/geo-cell";
import { projectLngLatToTrack } from "@/lib/track-measure";
import type { StoredCoord } from "@/lib/track-coords";

export const runtime = "nodejs";

const VALID_KINDS = new Set<HazardKind>([
  "landslide",
  "avalanche",
  "technical_trail",
  "snow_condition",
  "other",
]);

export async function POST(req: Request) {
  const auth = await requireAuthenticated();
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = (await req.json()) as {
    lat: number;
    lng: number;
    kind: HazardKind;
    text?: string;
    trackId?: string;
  };

  if (
    typeof body.lat !== "number" ||
    typeof body.lng !== "number" ||
    !VALID_KINDS.has(body.kind)
  ) {
    return NextResponse.json({ error: "lat, lng e kind validi richiesti" }, { status: 400 });
  }

  let alongKm: number | null = null;
  if (body.trackId) {
    const track = getTrackForOwner(body.trackId, auth.email) ?? getTrack(body.trackId);
    if (track) {
      const coords = JSON.parse(track.coords_json) as StoredCoord[];
      const proj = projectLngLatToTrack(coords, body.lng, body.lat);
      alongKm = proj?.alongKm ?? null;
    }
  }

  const cellId = geohashCellId(body.lat, body.lng, body.kind);
  const now = Date.now();

  const cell = insertGeoHazardReport({
    id: crypto.randomUUID(),
    cell_id: cellId,
    reporter_id: auth.email,
    lat: body.lat,
    lng: body.lng,
    kind: body.kind,
    body: body.text ?? null,
    track_id: body.trackId ?? null,
    along_km: alongKm,
    created_at: now,
    consensusThreshold: HAZARD_CONSENSUS_THRESHOLD,
  });

  return NextResponse.json({
    cell_id: cell.cell_id,
    report_count: cell.report_count,
    confirmed: !!cell.confirmed_at,
    along_km: alongKm,
  });
}
