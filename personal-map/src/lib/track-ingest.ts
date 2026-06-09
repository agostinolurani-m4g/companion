import fs from "node:fs";
import path from "node:path";
import type { Position } from "geojson";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { getDb, getTrack } from "@/lib/db";
import { parseGpxTrackpoints } from "@/lib/gpx";
import { simplifyLineStringWithIndices } from "@/lib/line-simplify";
import {
  cumulativeKmAlong,
  ELEV_GAIN_DEFAULT_THRESHOLD_M,
  ELEV_GAIN_DEFAULT_WINDOW_PTS,
  elevationGainLossSmoothed,
} from "@/lib/track-geometry";
import type { StoredCoord } from "@/lib/track-coords";
import { measureBetween } from "@/lib/track-measure";

export const SIMPLIFY_EPS_DEG = 0.00005;

export type IngestGpxResult = {
  trackId: string;
  name: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  point_count: number;
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  updated: boolean;
  rawPointCount: number;
};

export type IngestGpxOptions = {
  xml: string;
  trackId: string;
  name: string;
  ownerId: string;
  gpxRelPath: string;
  activityType?: string | null;
  persistGpxFile?: boolean;
};

function profileElevScale(official: number, measured: number): number {
  if (measured <= 0.5 || official <= 0) return 1;
  const r = official / measured;
  return Number.isFinite(r) && r > 0 ? r : 1;
}

export function slugifyTrackId(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "track";
}

export function resolveUniqueTrackId(
  base: string,
  exists: (id: string) => boolean,
  preferredId?: string
): string {
  const primary = preferredId ? slugifyTrackId(preferredId) : slugifyTrackId(base);
  if (!exists(primary)) return primary;
  if (preferredId && exists(primary)) return primary;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${primary}-${n}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error("Impossibile generare id traccia univoco");
}

export function displayNameFromGpxFilename(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return base.replace(/[_-]+/g, " ").trim() || "Percorso";
}

export function ingestGpxToDb(opts: IngestGpxOptions): IngestGpxResult {
  const xml = opts.xml?.trim();
  if (!xml) throw new Error("GPX vuoto");

  const trackId = opts.trackId.trim();
  const name = opts.name.trim();
  const ownerId = opts.ownerId.trim();
  if (!trackId) throw new Error("ID traccia richiesto");
  if (!name) throw new Error("Nome percorso richiesto");
  if (!ownerId) throw new Error("Owner richiesto");

  if (opts.persistGpxFile !== false && opts.gpxRelPath) {
    const abs = path.isAbsolute(opts.gpxRelPath)
      ? opts.gpxRelPath
      : path.join(process.cwd(), opts.gpxRelPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, xml, "utf8");
  }

  const pts = parseGpxTrackpoints(xml);
  if (pts.length < 2) {
    throw new Error("GPX senza almeno due punti traccia");
  }

  const raw: Position[] = pts.map((p) => {
    const c: Position = [p.lng, p.lat];
    if (p.eleM != null && Number.isFinite(p.eleM)) c.push(p.eleM);
    return c;
  });

  const rawElevations = pts.map((p) =>
    p.eleM != null && Number.isFinite(p.eleM) ? p.eleM : null
  );
  const { gain, loss } = elevationGainLossSmoothed(rawElevations, {
    windowPts: ELEV_GAIN_DEFAULT_WINDOW_PTS,
    thresholdM: ELEV_GAIN_DEFAULT_THRESHOLD_M,
  });

  const rawCum = cumulativeKmAlong(raw);
  const totalKm = rawCum[rawCum.length - 1];

  const { coords: simplified, indices: keptIdx } = simplifyLineStringWithIndices(
    raw,
    SIMPLIFY_EPS_DEG
  );
  const cum: number[] = keptIdx.map((i) => rawCum[i]);

  const lngs = simplified.map((c) => c[0]);
  const lats = simplified.map((c) => c[1]);
  const bbox = {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };

  const coordsJson: [number, number, number | null, number][] = simplified.map((c, i) => [
    Number(c[0].toFixed(6)),
    Number(c[1].toFixed(6)),
    typeof c[2] === "number" ? Math.round(c[2]) : null,
    Number(cum[i].toFixed(3)),
  ]);

  const storedCoords = coordsJson as unknown as StoredCoord[];
  const hiStored = storedCoords[storedCoords.length - 1][3];
  const profileRef = measureBetween(storedCoords, 0, hiStored);
  const elevProfileGainScale = profileElevScale(gain, profileRef.gainM);
  const elevProfileLossScale = profileElevScale(loss, profileRef.lossM);

  const db = getDb();
  const existingTrack = db.prepare(`SELECT id, created_at FROM tracks WHERE id = ?`).get(trackId) as
    | { id: string; created_at: number }
    | undefined;

  const tx = db.transaction(() => {
    const now = Date.now();
    const createdAt = existingTrack?.created_at ?? now;
    if (existingTrack) {
      db.prepare(
        `UPDATE tracks SET
           owner_id = ?, name = ?, gpx_path = ?, coords_json = ?, length_km = ?, elev_gain_m = ?, elev_loss_m = ?,
           elev_profile_gain_scale = ?, elev_profile_loss_scale = ?, bbox_json = ?, point_count = ?,
           activity_type = COALESCE(?, activity_type)
         WHERE id = ?`
      ).run(
        ownerId,
        name,
        opts.gpxRelPath,
        JSON.stringify(coordsJson),
        Number(totalKm.toFixed(3)),
        Math.round(gain),
        Math.round(loss),
        elevProfileGainScale,
        elevProfileLossScale,
        JSON.stringify(bbox),
        simplified.length,
        opts.activityType ?? null,
        trackId
      );
    } else {
      db.prepare(
        `INSERT INTO tracks (
           id, owner_id, name, gpx_path, coords_json, length_km, elev_gain_m, elev_loss_m,
           elev_profile_gain_scale, elev_profile_loss_scale, bbox_json, point_count,
           activity_type, source, visibility, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gpx_upload', 'private', ?)`
      ).run(
        trackId,
        ownerId,
        name,
        opts.gpxRelPath,
        JSON.stringify(coordsJson),
        Number(totalKm.toFixed(3)),
        Math.round(gain),
        Math.round(loss),
        elevProfileGainScale,
        elevProfileLossScale,
        JSON.stringify(bbox),
        simplified.length,
        opts.activityType ?? null,
        createdAt
      );
    }
  });

  tx();

  return {
    trackId,
    name,
    length_km: Number(totalKm.toFixed(3)),
    elev_gain_m: Math.round(gain),
    elev_loss_m: Math.round(loss),
    point_count: simplified.length,
    bbox,
    updated: !!existingTrack,
    rawPointCount: pts.length,
  };
}

export function trackExists(id: string): boolean {
  return !!getTrack(id);
}
