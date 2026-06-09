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
  migrateSchema(db);
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

    CREATE TABLE IF NOT EXISTS track_journal_entries (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      along_km REAL NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('note','photo','condition','milestone')),
      title TEXT,
      body TEXT,
      photo_path TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_track ON track_journal_entries(track_id, along_km);

    CREATE TABLE IF NOT EXISTS track_difficulty_segments (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      km_start REAL NOT NULL,
      km_end REAL NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('auto_steep','auto_osm','user_report','geo_consensus')),
      severity TEXT NOT NULL CHECK (severity IN ('info','caution','hard','extreme')),
      label TEXT NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_difficulty_track ON track_difficulty_segments(track_id, km_start);

    CREATE TABLE IF NOT EXISTS geo_hazard_cells (
      cell_id TEXT PRIMARY KEY,
      report_kind TEXT NOT NULL,
      report_count INTEGER NOT NULL DEFAULT 0,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      last_body TEXT,
      confirmed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hazard_cells_kind ON geo_hazard_cells(report_kind);

    CREATE TABLE IF NOT EXISTS geo_hazard_reports (
      id TEXT PRIMARY KEY,
      cell_id TEXT NOT NULL REFERENCES geo_hazard_cells(cell_id) ON DELETE CASCADE,
      reporter_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('landslide','avalanche','technical_trail','snow_condition','other')),
      body TEXT,
      track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
      along_km REAL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hazard_report_unique
      ON geo_hazard_reports(cell_id, reporter_id);

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('recording','completed','discarded')),
      name TEXT,
      activity_type TEXT,
      points_json TEXT NOT NULL DEFAULT '[]',
      track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities(owner_id, started_at DESC);
  `);
}

function migrateSchema(db: Database.Database): void {
  const trackCols = db.prepare(`PRAGMA table_info(tracks)`).all() as { name: string }[];
  const names = new Set(trackCols.map((c) => c.name));
  if (!names.has("sport_mode")) {
    db.exec(`ALTER TABLE tracks ADD COLUMN sport_mode TEXT`);
  }
  if (!names.has("journal_summary")) {
    db.exec(`ALTER TABLE tracks ADD COLUMN journal_summary TEXT`);
  }
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
  sport_mode?: string | null;
  journal_summary?: string | null;
  source: string;
  visibility: string;
  created_at: number;
};

export type JournalEntryKind = "note" | "photo" | "condition" | "milestone";

export type TrackJournalEntryRow = {
  id: string;
  track_id: string;
  along_km: number;
  kind: JournalEntryKind;
  title: string | null;
  body: string | null;
  photo_path: string | null;
  created_at: number;
};

export type DifficultySource = "auto_steep" | "auto_osm" | "user_report" | "geo_consensus";
export type DifficultySeverity = "info" | "caution" | "hard" | "extreme";

export type TrackDifficultySegmentRow = {
  id: string;
  track_id: string;
  km_start: number;
  km_end: number;
  source: DifficultySource;
  severity: DifficultySeverity;
  label: string;
  metadata_json: string | null;
  created_at: number;
};

export type HazardKind = "landslide" | "avalanche" | "technical_trail" | "snow_condition" | "other";

export type GeoHazardCellRow = {
  cell_id: string;
  report_kind: string;
  report_count: number;
  lat: number;
  lng: number;
  last_body: string | null;
  confirmed_at: number | null;
  updated_at: number;
};

export type GeoHazardReportRow = {
  id: string;
  cell_id: string;
  reporter_id: string;
  lat: number;
  lng: number;
  kind: HazardKind;
  body: string | null;
  track_id: string | null;
  along_km: number | null;
  created_at: number;
};

export type ActivityStatus = "recording" | "completed" | "discarded";

export type ActivityRow = {
  id: string;
  owner_id: string;
  status: ActivityStatus;
  name: string | null;
  activity_type: string | null;
  points_json: string;
  track_id: string | null;
  started_at: number;
  ended_at: number | null;
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

export function updateTrackJournalMeta(
  trackId: string,
  ownerId: string,
  patch: { journal_summary?: string | null; sport_mode?: string | null }
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];
  if ("journal_summary" in patch) {
    sets.push("journal_summary = ?");
    params.push(patch.journal_summary ?? null);
  }
  if ("sport_mode" in patch) {
    sets.push("sport_mode = ?");
    params.push(patch.sport_mode ?? null);
  }
  if (sets.length === 0) return false;
  params.push(trackId, ownerId);
  const res = getDb()
    .prepare(`UPDATE tracks SET ${sets.join(", ")} WHERE id = ? AND owner_id = ?`)
    .run(...params);
  return res.changes > 0;
}

export function listJournalEntries(trackId: string): TrackJournalEntryRow[] {
  return getDb()
    .prepare(`SELECT * FROM track_journal_entries WHERE track_id = ? ORDER BY along_km ASC, created_at ASC`)
    .all(trackId) as TrackJournalEntryRow[];
}

export function getJournalEntry(id: string): TrackJournalEntryRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM track_journal_entries WHERE id = ?`)
    .get(id) as TrackJournalEntryRow | undefined;
}

export function insertJournalEntry(input: {
  id: string;
  track_id: string;
  along_km: number;
  kind: JournalEntryKind;
  title?: string | null;
  body?: string | null;
  photo_path?: string | null;
  created_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO track_journal_entries (id, track_id, along_km, kind, title, body, photo_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.track_id,
      input.along_km,
      input.kind,
      input.title ?? null,
      input.body ?? null,
      input.photo_path ?? null,
      input.created_at
    );
}

export function updateJournalEntry(
  id: string,
  patch: { title?: string | null; body?: string | null; along_km?: number }
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];
  if ("title" in patch) {
    sets.push("title = ?");
    params.push(patch.title ?? null);
  }
  if ("body" in patch) {
    sets.push("body = ?");
    params.push(patch.body ?? null);
  }
  if ("along_km" in patch && typeof patch.along_km === "number") {
    sets.push("along_km = ?");
    params.push(patch.along_km);
  }
  if (sets.length === 0) return false;
  params.push(id);
  const res = getDb()
    .prepare(`UPDATE track_journal_entries SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
  return res.changes > 0;
}

export function deleteJournalEntry(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM track_journal_entries WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function listTrackDifficultySegments(trackId: string): TrackDifficultySegmentRow[] {
  return getDb()
    .prepare(`SELECT * FROM track_difficulty_segments WHERE track_id = ? ORDER BY km_start ASC`)
    .all(trackId) as TrackDifficultySegmentRow[];
}

export function replaceTrackDifficultySegments(
  trackId: string,
  segments: Array<{
    km_start: number;
    km_end: number;
    source: DifficultySource;
    severity: DifficultySeverity;
    label: string;
    metadata_json?: string | null;
  }>
): void {
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM track_difficulty_segments WHERE track_id = ?`).run(trackId);
    const ins = db.prepare(
      `INSERT INTO track_difficulty_segments
       (id, track_id, km_start, km_end, source, severity, label, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of segments) {
      ins.run(
        crypto.randomUUID(),
        trackId,
        s.km_start,
        s.km_end,
        s.source,
        s.severity,
        s.label,
        s.metadata_json ?? null,
        now
      );
    }
  });
  tx();
}

export function listGeoHazardCellsInBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number
): GeoHazardCellRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM geo_hazard_cells
       WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`
    )
    .all(minLat, maxLat, minLng, maxLng) as GeoHazardCellRow[];
}

export function getGeoHazardCell(cellId: string): GeoHazardCellRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM geo_hazard_cells WHERE cell_id = ?`)
    .get(cellId) as GeoHazardCellRow | undefined;
}

export function insertGeoHazardReport(input: {
  id: string;
  cell_id: string;
  reporter_id: string;
  lat: number;
  lng: number;
  kind: HazardKind;
  body?: string | null;
  track_id?: string | null;
  along_km?: number | null;
  created_at: number;
  consensusThreshold: number;
}): GeoHazardCellRow {
  const db = getDb();
  const tx = db.transaction(() => {
    const existing = db
      .prepare(`SELECT id FROM geo_hazard_reports WHERE cell_id = ? AND reporter_id = ?`)
      .get(input.cell_id, input.reporter_id);
    if (existing) {
      const cell = db
        .prepare(`SELECT * FROM geo_hazard_cells WHERE cell_id = ?`)
        .get(input.cell_id) as GeoHazardCellRow;
      return cell;
    }

    db.prepare(
      `INSERT INTO geo_hazard_reports
       (id, cell_id, reporter_id, lat, lng, kind, body, track_id, along_km, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.cell_id,
      input.reporter_id,
      input.lat,
      input.lng,
      input.kind,
      input.body ?? null,
      input.track_id ?? null,
      input.along_km ?? null,
      input.created_at
    );

    const countRow = db
      .prepare(`SELECT COUNT(DISTINCT reporter_id) AS n FROM geo_hazard_reports WHERE cell_id = ?`)
      .get(input.cell_id) as { n: number };

    const now = input.created_at;
    const confirmed =
      countRow.n >= input.consensusThreshold ? (now as number) : null;

    db.prepare(
      `INSERT INTO geo_hazard_cells (cell_id, report_kind, report_count, lat, lng, last_body, confirmed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cell_id) DO UPDATE SET
         report_count = excluded.report_count,
         last_body = COALESCE(excluded.last_body, geo_hazard_cells.last_body),
         confirmed_at = CASE
           WHEN excluded.report_count >= ? THEN COALESCE(geo_hazard_cells.confirmed_at, excluded.confirmed_at)
           ELSE geo_hazard_cells.confirmed_at
         END,
         updated_at = excluded.updated_at`
    ).run(
      input.cell_id,
      input.kind,
      countRow.n,
      input.lat,
      input.lng,
      input.body ?? null,
      confirmed,
      now,
      input.consensusThreshold
    );

    return db
      .prepare(`SELECT * FROM geo_hazard_cells WHERE cell_id = ?`)
      .get(input.cell_id) as GeoHazardCellRow;
  });
  return tx();
}

export function createActivity(input: {
  id: string;
  owner_id: string;
  name?: string | null;
  activity_type?: string | null;
  started_at: number;
  created_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO activities (id, owner_id, status, name, activity_type, points_json, started_at, created_at)
       VALUES (?, ?, 'recording', ?, ?, '[]', ?, ?)`
    )
    .run(
      input.id,
      input.owner_id,
      input.name ?? null,
      input.activity_type ?? null,
      input.started_at,
      input.created_at
    );
}

export function getActivityForOwner(id: string, ownerId: string): ActivityRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM activities WHERE id = ? AND owner_id = ?`)
    .get(id, ownerId) as ActivityRow | undefined;
}

export function getActiveRecordingForOwner(ownerId: string): ActivityRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM activities WHERE owner_id = ? AND status = 'recording' ORDER BY started_at DESC LIMIT 1`
    )
    .get(ownerId) as ActivityRow | undefined;
}

export function listActivities(ownerId: string, limit = 50): ActivityRow[] {
  return getDb()
    .prepare(`SELECT * FROM activities WHERE owner_id = ? ORDER BY started_at DESC LIMIT ?`)
    .all(ownerId, limit) as ActivityRow[];
}

export function appendActivityPoints(activityId: string, ownerId: string, newPoints: unknown[]): boolean {
  const row = getActivityForOwner(activityId, ownerId);
  if (!row || row.status !== "recording") return false;
  let existing: unknown[] = [];
  try {
    existing = JSON.parse(row.points_json) as unknown[];
  } catch {
    existing = [];
  }
  const merged = [...existing, ...newPoints];
  const res = getDb()
    .prepare(`UPDATE activities SET points_json = ? WHERE id = ? AND owner_id = ?`)
    .run(JSON.stringify(merged), activityId, ownerId);
  return res.changes > 0;
}

export function completeActivity(
  activityId: string,
  ownerId: string,
  trackId: string,
  endedAt: number
): boolean {
  const res = getDb()
    .prepare(
      `UPDATE activities SET status = 'completed', track_id = ?, ended_at = ? WHERE id = ? AND owner_id = ? AND status = 'recording'`
    )
    .run(trackId, endedAt, activityId, ownerId);
  return res.changes > 0;
}

export function discardActivity(activityId: string, ownerId: string): boolean {
  const res = getDb()
    .prepare(
      `UPDATE activities SET status = 'discarded', ended_at = ? WHERE id = ? AND owner_id = ? AND status = 'recording'`
    )
    .run(Date.now(), activityId, ownerId);
  return res.changes > 0;
}
