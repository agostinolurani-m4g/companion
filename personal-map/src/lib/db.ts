import crypto from "node:crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_FILENAME = "personal.db";

function resolveDbPath(): string {
  const override = process.env.PERSONAL_DB_PATH?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }
  return path.join(process.cwd(), "data", DEFAULT_FILENAME);
}

let dbInstance: Database.Database | null = null;
let dbOpenedPath: string | null = null;

export function resetDbConnection(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbOpenedPath = null;
  }
}

export function getDb(): Database.Database {
  const target = resolveDbPath();
  if (dbInstance && dbOpenedPath === target) return dbInstance;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  dbInstance = db;
  dbOpenedPath = target;
  return db;
}

export function getDbPath(): string {
  return resolveDbPath();
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      gpx_path TEXT,
      coords_json TEXT NOT NULL,
      length_km REAL NOT NULL,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      elev_loss_m REAL NOT NULL DEFAULT 0,
      elev_profile_gain_scale REAL NOT NULL DEFAULT 1,
      elev_profile_loss_scale REAL NOT NULL DEFAULT 1,
      bbox_json TEXT NOT NULL,
      point_count INTEGER NOT NULL,
      activity_type TEXT,
      source TEXT NOT NULL DEFAULT 'gpx_upload',
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_owner ON tracks(owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS pois (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      sub_kind TEXT,
      name TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      along_km REAL NOT NULL,
      detour_m REAL NOT NULL,
      elev_delta_m REAL,
      phone TEXT,
      website TEXT,
      opening_hours TEXT,
      description TEXT,
      image_url TEXT,
      osm_type TEXT,
      osm_id INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pois_track_category ON pois(track_id, category);
    CREATE INDEX IF NOT EXISTS idx_pois_track_along ON pois(track_id, along_km);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pois_track_osm ON pois(track_id, osm_type, osm_id)
      WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS track_notes (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      along_km REAL NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_track_notes_track ON track_notes(track_id, along_km);

    CREATE TABLE IF NOT EXISTS track_surface_segments (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      km_start REAL NOT NULL,
      km_end REAL NOT NULL,
      surface TEXT NOT NULL CHECK (surface IN ('asphalt','gravel','single','unknown')),
      source TEXT NOT NULL DEFAULT 'osm_overpass'
    );
    CREATE INDEX IF NOT EXISTS idx_surface_track ON track_surface_segments(track_id, km_start);

    CREATE TABLE IF NOT EXISTS geo_api_cache (
      cache_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_email ON auth_sessions(email, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_ingest_credits (
      username TEXT PRIMARY KEY,
      credits_remaining INTEGER NOT NULL DEFAULT 1
    );
  `);
}

export type PoiCategory =
  | "water"
  | "hut"
  | "lodging"
  | "campsite"
  | "shop"
  | "restaurant"
  | "pharmacy"
  | "atm"
  | "bus";

export type TrackRow = {
  id: string;
  owner_id: string;
  name: string;
  gpx_path: string | null;
  coords_json: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  elev_profile_gain_scale?: number;
  elev_profile_loss_scale?: number;
  bbox_json: string;
  point_count: number;
  activity_type: string | null;
  source: string;
  visibility: string;
  created_at: number;
};

export type PoiRow = {
  id: string;
  track_id: string;
  category: PoiCategory;
  sub_kind: string | null;
  name: string | null;
  lat: number;
  lng: number;
  along_km: number;
  detour_m: number;
  elev_delta_m: number | null;
  phone: string | null;
  website: string | null;
  opening_hours: string | null;
  description: string | null;
  image_url: string | null;
  osm_type: string | null;
  osm_id: number | null;
  created_at: number;
};

export type TrackSurfaceSegmentRow = {
  id: string;
  track_id: string;
  km_start: number;
  km_end: number;
  surface: "asphalt" | "gravel" | "single" | "unknown";
  source: string;
};

export type TrackNoteRow = {
  id: string;
  track_id: string;
  along_km: number;
  text: string;
  created_at: number;
};

/** Stub types per ElevationChart (non usati in personal-map v1). */
export type CheckpointRow = {
  id: string;
  name: string;
  kind: string;
  along_km: number;
  lat: number;
  lng: number;
};

export type NotableSectionRow = {
  id: string;
  label: string;
  km_start: number;
  km_end: number;
  severity: string;
  description: string;
  description_en?: string;
};

export type RacePlanItemRow = {
  id: string;
  km_start: number;
  km_end: number;
  kind: string;
  title: string;
};

export type AuthSessionRow = {
  id: string;
  email: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
};

export function listTracks(ownerId?: string): TrackRow[] {
  if (ownerId) {
    return getDb()
      .prepare(`SELECT * FROM tracks WHERE owner_id = ? ORDER BY created_at DESC`)
      .all(ownerId) as TrackRow[];
  }
  return getDb().prepare(`SELECT * FROM tracks ORDER BY created_at DESC`).all() as TrackRow[];
}

export function getTrack(id: string): TrackRow | undefined {
  return getDb().prepare(`SELECT * FROM tracks WHERE id = ?`).get(id) as TrackRow | undefined;
}

export function getTrackForOwner(id: string, ownerId: string): TrackRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM tracks WHERE id = ? AND owner_id = ?`)
    .get(id, ownerId) as TrackRow | undefined;
}

export function deleteTrack(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM tracks WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function listPois(
  trackId: string,
  opts?: { categories?: PoiCategory[]; fromKm?: number; toKm?: number; maxDetourM?: number }
): PoiRow[] {
  const clauses: string[] = [`track_id = ?`];
  const params: unknown[] = [trackId];
  if (opts?.categories && opts.categories.length > 0) {
    clauses.push(`category IN (${opts.categories.map(() => "?").join(",")})`);
    params.push(...opts.categories);
  }
  if (typeof opts?.fromKm === "number") {
    clauses.push(`along_km >= ?`);
    params.push(opts.fromKm);
  }
  if (typeof opts?.toKm === "number") {
    clauses.push(`along_km <= ?`);
    params.push(opts.toKm);
  }
  if (typeof opts?.maxDetourM === "number") {
    clauses.push(`detour_m <= ?`);
    params.push(opts.maxDetourM);
  }
  const sql = `SELECT * FROM pois WHERE ${clauses.join(" AND ")} ORDER BY along_km ASC`;
  return getDb().prepare(sql).all(...params) as PoiRow[];
}

export function countPois(trackId: string): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM pois WHERE track_id = ?`)
    .get(trackId) as { n: number };
  return r.n;
}

export function listTrackSurfaceSegments(trackId: string): TrackSurfaceSegmentRow[] {
  return getDb()
    .prepare(`SELECT * FROM track_surface_segments WHERE track_id = ? ORDER BY km_start ASC`)
    .all(trackId) as TrackSurfaceSegmentRow[];
}

export function replaceTrackSurfaceSegments(
  trackId: string,
  segments: Array<{ km_start: number; km_end: number; surface: TrackSurfaceSegmentRow["surface"] }>
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM track_surface_segments WHERE track_id = ?`).run(trackId);
    const ins = db.prepare(
      `INSERT INTO track_surface_segments (id, track_id, km_start, km_end, surface, source)
       VALUES (?, ?, ?, ?, ?, 'osm_overpass')`
    );
    for (const s of segments) {
      ins.run(
        crypto.randomUUID(),
        trackId,
        s.km_start,
        s.km_end,
        s.surface
      );
    }
  });
  tx();
}

export function geoCacheGet(key: string): unknown | null {
  const row = getDb()
    .prepare(`SELECT payload_json, fetched_at FROM geo_api_cache WHERE cache_key = ?`)
    .get(key) as { payload_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  const ttl = 7 * 24 * 3600;
  const now = Math.floor(Date.now() / 1000);
  if (now - row.fetched_at > ttl) return null;
  try {
    return JSON.parse(row.payload_json) as unknown;
  } catch {
    return null;
  }
}

export function geoCacheSet(key: string, payload: unknown): void {
  const json = JSON.stringify(payload);
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(
      `INSERT INTO geo_api_cache (cache_key, payload_json, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         fetched_at = excluded.fetched_at`
    )
    .run(key, json, now);
}

export function insertAuthSession(input: {
  id: string;
  email: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO auth_sessions (id, email, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.id, input.email, input.token_hash, input.created_at, input.expires_at);
}

export function getAuthSessionByTokenHash(tokenHash: string): AuthSessionRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM auth_sessions WHERE token_hash = ?`)
    .get(tokenHash) as AuthSessionRow | undefined;
}

export function deleteAuthSessionById(id: string): void {
  getDb().prepare(`DELETE FROM auth_sessions WHERE id = ?`).run(id);
}

export function pruneAuthSessions(now: number): void {
  getDb().prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`).run(now);
}
