import crypto from "node:crypto";
import { getTrack, replaceTrackSurfaceSegments, type TrackRow } from "@/lib/db";
import { fetchHighwayWaysGeomInBbox, type Bbox, type OsmWayGeom } from "@/lib/overpass";
import type { StoredCoord } from "@/lib/track-coords";
import {
  approxDistanceM,
  medianSmoothKinds,
  mergeSurfaceSpans,
  surfaceAtPoint,
  waysToSegments,
  type TrackSurfaceKind,
  type WaySeg,
} from "@/lib/surface-osm";

const BIN_DEG = 0.028;
const MAX_NEAR_SEGMENTS = 2800;

export type SnapshotSurfaceRunOptions = {
  bboxPad?: number;
  gridCols?: number;
  gridRows?: number;
  sampleKm?: number;
  medianWin?: number;
  pauseMs?: number;
  log?: (msg: string) => void;
};

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

function envFloat(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] ?? "");
  return Number.isFinite(v) ? v : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function splitBbox(b: Bbox, cols: number, rows: number): Bbox[] {
  const [s, w, n, e] = b;
  const dLat = (n - s) / rows;
  const dLng = (e - w) / cols;
  const out: Bbox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push([s + r * dLat, w + c * dLng, s + (r + 1) * dLat, w + (c + 1) * dLng]);
    }
  }
  return out;
}

function neighborBinKeys(lng: number, lat: number): string[] {
  const ci = Math.floor(lng / BIN_DEG);
  const cj = Math.floor(lat / BIN_DEG);
  const keys: string[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      keys.push(`${ci + di},${cj + dj}`);
    }
  }
  return keys;
}

function buildBinMap(segments: WaySeg[]): Map<string, WaySeg[]> {
  const map = new Map<string, WaySeg[]>();
  for (const s of segments) {
    const mx = (s.ax + s.bx) / 2;
    const my = (s.ay + s.by) / 2;
    for (const k of neighborBinKeys(mx, my)) {
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }
  }
  return map;
}

function collectSegments(lng: number, lat: number, binMap: Map<string, WaySeg[]>): WaySeg[] {
  const seen = new Set<string>();
  const out: WaySeg[] = [];
  for (const k of neighborBinKeys(lng, lat)) {
    for (const s of binMap.get(k) ?? []) {
      const id = `${s.wayId}|${s.ax}|${s.ay}|${s.bx}|${s.by}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(s);
    }
  }
  if (out.length <= MAX_NEAR_SEGMENTS) return out;
  const scored = out.map((s) => {
    const mx = (s.ax + s.bx) / 2;
    const my = (s.ay + s.by) / 2;
    return { s, d: approxDistanceM(lng, lat, mx, my) };
  });
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, MAX_NEAR_SEGMENTS).map((x) => x.s);
}

function sampleAlongTrack(
  coords: StoredCoord[],
  lengthKm: number,
  sampleKm: number
): { lng: number; lat: number; km: number }[] {
  if (coords.length < 2) return [];
  const out: { lng: number; lat: number; km: number }[] = [];
  out.push({ lng: coords[0]![0], lat: coords[0]![1], km: 0 });
  let nextH = 0;
  for (let i = 1; i < coords.length; i++) {
    const c = coords[i]!;
    const km = c[3];
    while (km >= nextH + sampleKm) {
      nextH += sampleKm;
      out.push({ lng: c[0], lat: c[1], km: Math.min(nextH, lengthKm) });
    }
  }
  const last = coords[coords.length - 1]!;
  if (out[out.length - 1]!.km < lengthKm - 0.02) {
    out.push({ lng: last[0], lat: last[1], km: lengthKm });
  }
  return out;
}

function resolveTrack(trackId: string): TrackRow {
  const t = getTrack(trackId);
  if (!t) throw new Error(`Traccia "${trackId}" non trovata nel database`);
  return t;
}

export async function runSurfaceSnapshotForTrack(
  trackId: string,
  opts?: SnapshotSurfaceRunOptions
): Promise<void> {
  const log = opts?.log ?? ((m: string) => console.log(m));
  const track = resolveTrack(trackId);

  const BBOX_PAD = opts?.bboxPad ?? envFloat("HMR_SURFACE_BBOX_PAD", 0.025);
  const GRID_COLS = opts?.gridCols ?? envInt("HMR_SURFACE_GRID_COLS", 3);
  const GRID_ROWS = opts?.gridRows ?? envInt("HMR_SURFACE_GRID_ROWS", 4);
  const SAMPLE_KM = opts?.sampleKm ?? envFloat("HMR_SURFACE_SAMPLE_KM", 0.55);
  const MEDIAN_WIN = opts?.medianWin ?? envInt("HMR_SURFACE_MEDIAN", 3);
  const BETWEEN_MS = opts?.pauseMs ?? envInt("HMR_SURFACE_PAUSE_MS", 900);

  const bbox = JSON.parse(track.bbox_json) as {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  const outer: Bbox = [
    bbox.minLat - BBOX_PAD,
    bbox.minLng - BBOX_PAD,
    bbox.maxLat + BBOX_PAD,
    bbox.maxLng + BBOX_PAD,
  ];
  const cells = splitBbox(outer, GRID_COLS, GRID_ROWS);
  log(`[surface] ${GRID_COLS}×${GRID_ROWS} celle · track=${track.id}`);

  const wayById = new Map<number, OsmWayGeom>();
  let cellIdx = 0;
  for (const cell of cells) {
    cellIdx += 1;
    try {
      const ways = await fetchHighwayWaysGeomInBbox(cell);
      for (const w of ways) {
        const prev = wayById.get(w.id);
        if (!prev || (w.geometry?.length ?? 0) > (prev.geometry?.length ?? 0)) {
          wayById.set(w.id, w);
        }
      }
      log(`[surface] cella ${cellIdx}/${cells.length} ways=${ways.length}`);
    } catch (e) {
      log(`[surface] cella ${cellIdx} errore: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(BETWEEN_MS);
  }

  const segments = waysToSegments([...wayById.values()]);
  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  const lengthKm = track.length_km;
  const samples = sampleAlongTrack(coords, lengthKm, SAMPLE_KM);
  const binMap = buildBinMap(segments);
  const rawKinds: TrackSurfaceKind[] = [];
  const kms: number[] = [];
  for (const p of samples) {
    rawKinds.push(surfaceAtPoint(p.lng, p.lat, collectSegments(p.lng, p.lat, binMap), 150));
    kms.push(p.km);
  }
  const smoothed =
    rawKinds.length >= MEDIAN_WIN ? medianSmoothKinds(rawKinds, MEDIAN_WIN) : rawKinds;
  const spans = mergeSurfaceSpans(kms, smoothed, lengthKm);
  const rows = spans.map((sp) => ({
    id: crypto.randomUUID(),
    km_start: sp.km_start,
    km_end: sp.km_end,
    surface: sp.surface,
    source: "osm_overpass" as const,
  }));
  replaceTrackSurfaceSegments(track.id, rows);
  log(`[surface] OK · ${spans.length} segmenti`);
}
