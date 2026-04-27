/**
 * Snapshot Overpass: classifica asfalto / sterrato / single lungo la traccia
 * (ways highway con geometria, griglia bbox come snapshot POI).
 *
 * Uso: dalla root hmr-companion/
 *   npm run snapshot:surface
 *
 * Richiede rete. Può richiedere diversi minuti (molte celle × Overpass).
 */

import crypto from "node:crypto";
import { getDbPath, getFirstTrack, replaceTrackSurfaceSegments } from "../src/lib/db";
import { fetchHighwayWaysGeomInBbox, type Bbox, type OsmWayGeom } from "../src/lib/overpass";
import type { StoredCoord } from "../src/lib/track-coords";
import {
  approxDistanceM,
  medianSmoothKinds,
  mergeSurfaceSpans,
  surfaceAtPoint,
  waysToSegments,
  type TrackSurfaceKind,
  type WaySeg,
} from "../src/lib/surface-osm";

const BBOX_PAD = parseFloat(process.env.HMR_SURFACE_BBOX_PAD ?? "0.025") || 0.025;
const GRID_COLS = parseInt(process.env.HMR_SURFACE_GRID_COLS ?? "3", 10) || 3;
const GRID_ROWS = parseInt(process.env.HMR_SURFACE_GRID_ROWS ?? "4", 10) || 4;
const SAMPLE_KM = parseFloat(process.env.HMR_SURFACE_SAMPLE_KM ?? "0.55") || 0.55;
const MEDIAN_WIN = parseInt(process.env.HMR_SURFACE_MEDIAN ?? "3", 10) || 3;
const BETWEEN_MS = parseInt(process.env.HMR_SURFACE_PAUSE_MS ?? "900", 10) || 900;
const BIN_DEG = 0.028;
const MAX_NEAR_SEGMENTS = 2800;

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

function collectSegments(
  lng: number,
  lat: number,
  binMap: Map<string, WaySeg[]>
): WaySeg[] {
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

function sampleAlongTrack(coords: StoredCoord[], lengthKm: number): { lng: number; lat: number; km: number }[] {
  if (coords.length < 2) return [];
  const out: { lng: number; lat: number; km: number }[] = [];
  out.push({ lng: coords[0]![0], lat: coords[0]![1], km: 0 });
  let nextH = 0;
  for (let i = 1; i < coords.length; i++) {
    const c = coords[i]!;
    const km = c[3];
    while (km >= nextH + SAMPLE_KM) {
      nextH += SAMPLE_KM;
      out.push({ lng: c[0], lat: c[1], km: Math.min(nextH, lengthKm) });
    }
  }
  const last = coords[coords.length - 1]!;
  if (out[out.length - 1]!.km < lengthKm - 0.02) {
    out.push({ lng: last[0], lat: last[1], km: lengthKm });
  }
  return out;
}

async function main() {
  const track = getFirstTrack();
  if (!track) {
    console.error("[surface] Nessuna traccia nel DB. Esegui prima npm run ingest.");
    process.exit(1);
  }
  console.log(`[surface] DB: ${getDbPath()} · track=${track.id}`);

  const bbox = JSON.parse(track.bbox_json) as {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  const pad = BBOX_PAD;
  const outer: Bbox = [
    bbox.minLat - pad,
    bbox.minLng - pad,
    bbox.maxLat + pad,
    bbox.maxLng + pad,
  ];
  const cells = splitBbox(outer, GRID_COLS, GRID_ROWS);
  console.log(
    `[surface] Griglia ${GRID_COLS}×${GRID_ROWS} = ${cells.length} celle · sample ogni ${SAMPLE_KM} km`
  );

  const wayById = new Map<number, OsmWayGeom>();
  let cellIdx = 0;
  for (const cell of cells) {
    cellIdx += 1;
    process.stdout.write(`[surface] Cella ${cellIdx}/${cells.length}… `);
    try {
      const ways = await fetchHighwayWaysGeomInBbox(cell);
      for (const w of ways) {
        const prev = wayById.get(w.id);
        if (!prev || (w.geometry?.length ?? 0) > (prev.geometry?.length ?? 0)) {
          wayById.set(w.id, w);
        }
      }
      console.log(`ways +${ways.length} (unici ${wayById.size})`);
    } catch (e) {
      console.warn(`errore: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(BETWEEN_MS);
  }

  const allWays = [...wayById.values()];
  const segments = waysToSegments(allWays);
  console.log(`[surface] Segmenti OSM: ${segments.length}`);

  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  const lengthKm = track.length_km;
  const samples = sampleAlongTrack(coords, lengthKm);
  console.log(`[surface] Campioni traccia: ${samples.length}`);

  const binMap = buildBinMap(segments);
  const rawKinds: TrackSurfaceKind[] = [];
  const kms: number[] = [];
  for (const p of samples) {
    const cand = collectSegments(p.lng, p.lat, binMap);
    rawKinds.push(surfaceAtPoint(p.lng, p.lat, cand, 150));
    kms.push(p.km);
  }

  const smoothed =
    rawKinds.length >= MEDIAN_WIN ? medianSmoothKinds(rawKinds, MEDIAN_WIN) : rawKinds;
  const spans = mergeSurfaceSpans(kms, smoothed, lengthKm);
  console.log(`[surface] Segmenti classificati: ${spans.length}`);

  const rows = spans.map((sp) => ({
    id: crypto.randomUUID(),
    km_start: sp.km_start,
    km_end: sp.km_end,
    surface: sp.surface,
    source: "osm_overpass" as const,
  }));
  replaceTrackSurfaceSegments(track.id, rows);
  console.log(
    "[surface] Nota: questa operazione sostituisce tutti i segmenti (anche correzioni manuali da app)."
  );

  const sum = { asphalt: 0, gravel: 0, single: 0, unknown: 0 };
  for (const sp of spans) {
    const len = Math.max(0, sp.km_end - sp.km_start);
    sum[sp.surface] += len;
  }
  console.log(
    `[surface] OK · km: asfalto ${sum.asphalt.toFixed(1)} · sterrato ${sum.gravel.toFixed(1)} · single ${sum.single.toFixed(1)} · n/d ${sum.unknown.toFixed(1)}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
