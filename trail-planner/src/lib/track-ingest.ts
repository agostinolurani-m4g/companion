import fs from "node:fs";
import path from "node:path";
import type { Feature, LineString } from "geojson";
import { parseGpxTrackpoints } from "@/lib/gpx";
import { lineStringFromPositions, simplifyLineString, simplifyToMaxPoints } from "@/lib/line-simplify";
import { summarizeTrack } from "@/lib/track-stats";
import { encodePolyline, sampleForPreview } from "@/lib/polyline";
import type { Position } from "geojson";

const TRACKS_DIR = path.join(process.cwd(), "data", "tracks");

export function ensureTracksDir(): void {
  if (!fs.existsSync(TRACKS_DIR)) {
    fs.mkdirSync(TRACKS_DIR, { recursive: true });
  }
}

export function trackRawPath(trackId: string): string {
  return path.join(TRACKS_DIR, `${trackId}.gpx`);
}

function parseTimeToSec(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export type IngestResult = {
  trackId: string;
  summary: ReturnType<typeof summarizeTrack> & {
    display_point_count: number;
    encoded_preview: string;
  };
  displayFeature: Feature<LineString>;
  rawBytesWritten: number;
};

const MAX_DISPLAY_POINTS = 700;
const DP_EPS = 0.0001;

/**
 * Parsing GPX → stats, file raw su disco, geometria display semplificata.
 */
export function ingestGpxXml(xml: string, trackId: string): IngestResult {
  ensureTracksDir();
  const pts = parseGpxTrackpoints(xml);
  if (pts.length < 2) {
    throw new Error("GPX senza almeno due punti traccia");
  }

  const coords: Position[] = pts.map((p) => {
    const c: Position = [p.lng, p.lat];
    if (p.eleM != null) c.push(p.eleM);
    return c;
  });
  const eles = pts.map((p) => p.eleM);
  const times = pts.map((p) => parseTimeToSec(p.timeIso));

  const base = summarizeTrack(coords, eles, times);
  let simplified = simplifyLineString(coords, DP_EPS);
  simplified = simplifyToMaxPoints(simplified, MAX_DISPLAY_POINTS);

  const displayFeature: Feature<LineString> = {
    type: "Feature",
    properties: {},
    geometry: lineStringFromPositions(simplified),
  };

  const rawPath = trackRawPath(trackId);
  fs.writeFileSync(rawPath, xml, "utf8");

  const previewCoords = sampleForPreview(
    simplified.map((c) => [c[0], c[1]] as [number, number]),
    48
  );
  const encoded_preview = encodePolyline(previewCoords);

  return {
    trackId,
    summary: {
      ...base,
      display_point_count: simplified.length,
      encoded_preview,
    },
    displayFeature,
    rawBytesWritten: Buffer.byteLength(xml, "utf8"),
  };
}

/** Ricalcola display da file .gpx grezzo (tool `set_route_from_track`). */
export function rebuildTrackDisplayFromRaw(
  trackId: string,
  opts?: { epsilonDeg?: number; maxPoints?: number }
): IngestResult {
  ensureTracksDir();
  const rawPath = trackRawPath(trackId);
  if (!fs.existsSync(rawPath)) {
    throw new Error("File traccia grezza non trovato");
  }
  const xml = fs.readFileSync(rawPath, "utf8");
  const epsilonDeg = opts?.epsilonDeg ?? 0.0001;
  const maxPoints = opts?.maxPoints ?? MAX_DISPLAY_POINTS;
  const pts = parseGpxTrackpoints(xml);
  if (pts.length < 2) {
    throw new Error("Traccia non valida");
  }
  const coords: Position[] = pts.map((p) => {
    const c: Position = [p.lng, p.lat];
    if (p.eleM != null) c.push(p.eleM);
    return c;
  });
  const eles = pts.map((p) => p.eleM);
  const times = pts.map((p) => parseTimeToSec(p.timeIso));

  const base = summarizeTrack(coords, eles, times);
  let simplified = simplifyLineString(coords, epsilonDeg);
  simplified = simplifyToMaxPoints(simplified, maxPoints);

  const displayFeature: Feature<LineString> = {
    type: "Feature",
    properties: {},
    geometry: lineStringFromPositions(simplified),
  };

  const previewCoords = sampleForPreview(
    simplified.map((c) => [c[0], c[1]] as [number, number]),
    48
  );
  const encoded_preview = encodePolyline(previewCoords);

  return {
    trackId,
    summary: {
      ...base,
      display_point_count: simplified.length,
      encoded_preview,
    },
    displayFeature,
    rawBytesWritten: fs.statSync(rawPath).size,
  };
}
