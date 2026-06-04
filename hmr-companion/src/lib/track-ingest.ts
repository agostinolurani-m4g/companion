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
  nearestPointOnPolyline,
  positionAtKm,
} from "@/lib/track-geometry";
import type { StoredCoord } from "@/lib/track-coords";
import { measureBetween } from "@/lib/track-measure";
import { reseedCourseMarkers } from "@/lib/reseed-course-markers";
import { STATIC_CHECKPOINTS } from "@/lib/seed-static";

export const HMR_OFFICIAL_TRACK_ID = "hmr-2026";
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
  /** Percorso relativo a process.cwd(), es. data/uploads/foo.gpx */
  gpxRelPath: string;
  seedHmrCourseMarkers?: boolean;
  /** Se true, scrive xml su disco in gpxRelPath */
  persistGpxFile?: boolean;
};

function profileElevScale(official: number, measured: number): number {
  if (measured <= 0.5 || official <= 0) return 1;
  const r = official / measured;
  return Number.isFinite(r) && r > 0 ? r : 1;
}

/** Slug id traccia da nome file o titolo gara. */
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
  return base.replace(/[_-]+/g, " ").trim() || "Gara";
}

function seedHmrCheckpoints(
  db: SqliteDatabase,
  trackId: string,
  simplified: Position[],
  cum: number[],
  log: (msg: string) => void
): void {
  db.prepare(`DELETE FROM checkpoints WHERE track_id = ?`).run(trackId);
  const insCp = db.prepare(
    `INSERT INTO checkpoints (id, track_id, name, kind, label, lat, lng, along_km, cutoff_utc, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const cp of STATIC_CHECKPOINTS) {
    const projectedByKm = positionAtKm(simplified, cum, cp.along_km);
    const nearest = nearestPointOnPolyline(simplified, [cp.lng, cp.lat], cum);
    const sanityDelta =
      nearest && Number.isFinite(nearest.alongKm)
        ? Math.abs(nearest.alongKm - cp.along_km)
        : null;
    if (sanityDelta != null && sanityDelta > 5) {
      log(
        `⚠ CP ${cp.name}: lat/lng del seed proietta a km ${nearest!.alongKm.toFixed(1)}, ` +
          `ma il manuale dichiara km ${cp.along_km} (Δ ${sanityDelta.toFixed(1)} km).`
      );
    }
    insCp.run(
      cp.id,
      trackId,
      cp.name,
      cp.kind,
      cp.label,
      Number(projectedByKm[1].toFixed(6)),
      Number(projectedByKm[0].toFixed(6)),
      Number(cp.along_km.toFixed(3)),
      cp.cutoff_utc,
      cp.notes
    );
  }
}

/**
 * Parse GPX → semplifica → salva in `tracks` (+ seed HMR opzionale).
 */
export function ingestGpxToDb(opts: IngestGpxOptions): IngestGpxResult {
  const xml = opts.xml?.trim();
  if (!xml) throw new Error("GPX vuoto");

  const trackId = opts.trackId.trim();
  const name = opts.name.trim();
  if (!trackId) throw new Error("ID traccia richiesto");
  if (!name) throw new Error("Nome gara richiesto");

  const seedHmr =
    opts.seedHmrCourseMarkers === true && trackId === HMR_OFFICIAL_TRACK_ID;

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
           name = ?, gpx_path = ?, coords_json = ?, length_km = ?, elev_gain_m = ?, elev_loss_m = ?,
           elev_profile_gain_scale = ?, elev_profile_loss_scale = ?, bbox_json = ?, point_count = ?
         WHERE id = ?`
      ).run(
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
        trackId
      );
    } else {
      db.prepare(
        `INSERT INTO tracks (id, name, gpx_path, coords_json, length_km, elev_gain_m, elev_loss_m, elev_profile_gain_scale, elev_profile_loss_scale, bbox_json, point_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        trackId,
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
        createdAt
      );
    }

    if (seedHmr) {
      seedHmrCheckpoints(db, trackId, simplified, cum, () => {});
      reseedCourseMarkers(db, trackId, simplified, cum, totalKm);
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
