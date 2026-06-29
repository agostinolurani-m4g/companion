import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { StreetViewAlongItem } from "./along-media-types";
import { googleMapsStreetViewLayerUrl } from "./gmaps-url";
import type { RacePlanItemKind } from "./race-plan-types";
import type { TrackSurfaceKind } from "./surface-osm";

const DEFAULT_FILENAME = "hmr.db";

function resolveDbPath(): string {
  const override = process.env.HMR_DB_PATH?.trim();
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
      name TEXT NOT NULL,
      gpx_path TEXT,
      coords_json TEXT NOT NULL,        -- [[lng,lat,elev|null,cumKm],...]
      length_km REAL NOT NULL,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      elev_loss_m REAL NOT NULL DEFAULT 0,
      bbox_json TEXT NOT NULL,
      point_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('cp','finish','start')),
      label TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      along_km REAL NOT NULL,
      cutoff_utc INTEGER,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_track ON checkpoints(track_id);

    CREATE TABLE IF NOT EXISTS official_resupply (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      along_km REAL NOT NULL,
      leg_km REAL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_resupply_track ON official_resupply(track_id, along_km);

    CREATE TABLE IF NOT EXISTS notable_sections (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      km_start REAL NOT NULL,
      km_end REAL NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('info','warn','hard')),
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sections_track ON notable_sections(track_id, km_start);

    CREATE TABLE IF NOT EXISTS course_bridges (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      along_km REAL NOT NULL,
      description_en TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_bridges_track ON course_bridges(track_id, along_km);

    CREATE TABLE IF NOT EXISTS pois (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      category TEXT NOT NULL,           -- water|hut|lodging|campsite|shop|restaurant|pharmacy|atm|bus
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
      created_at INTEGER NOT NULL,
      race_visible INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pois_track_category ON pois(track_id, category);
    CREATE INDEX IF NOT EXISTS idx_pois_track_along ON pois(track_id, along_km);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pois_track_osm ON pois(track_id, osm_type, osm_id)
      WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      poi_id TEXT NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('planned','visited','avoid','info')),
      body TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_poi ON notes(poi_id);

    CREATE TABLE IF NOT EXISTS poi_field_photos (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      photo_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poi_field_photos_note ON poi_field_photos(note_id);

    CREATE TABLE IF NOT EXISTS race_plans (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_race_plans_track ON race_plans(track_id, created_at);

    CREATE TABLE IF NOT EXISTS race_plan_items (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES race_plans(id) ON DELETE CASCADE,
      km_start REAL NOT NULL,
      km_end REAL NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('note','sleep','stage','time','night_avoid')),
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      est_hours REAL,
      avoid_night INTEGER NOT NULL DEFAULT 0 CHECK (avoid_night IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_race_plan_items_plan ON race_plan_items(plan_id, km_start);

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

    CREATE TABLE IF NOT EXISTS track_street_view_points (
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      pano_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      along_km REAL NOT NULL,
      detour_m REAL NOT NULL,
      copyright TEXT,
      sample_lat REAL NOT NULL,
      sample_lng REAL NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (track_id, pano_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sv_points_track_km ON track_street_view_points(track_id, along_km);

    CREATE TABLE IF NOT EXISTS auth_magic_links (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_magic_links_email ON auth_magic_links(email, created_at DESC);

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

    CREATE TABLE IF NOT EXISTS app_users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_routes (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      activity TEXT NOT NULL CHECK(activity IN ('road','mtb','hike','gravel')),
      geojson TEXT NOT NULL,
      waypoints_json TEXT NOT NULL DEFAULT '[]',
      length_km REAL NOT NULL DEFAULT 0,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      elev_loss_m REAL NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_routes_owner ON user_routes(owner, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_routes_visibility ON user_routes(visibility, updated_at DESC);

    CREATE TABLE IF NOT EXISTS osm_poi (
      osm_type TEXT NOT NULL,
      osm_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      sub_kind TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      tags_json TEXT NOT NULL,
      PRIMARY KEY (osm_type, osm_id)
    );
    CREATE INDEX IF NOT EXISTS idx_osm_poi_category ON osm_poi(category);

    CREATE VIRTUAL TABLE IF NOT EXISTS osm_poi_rtree USING rtree(id, minLat, maxLat, minLng, maxLng);

    CREATE TABLE IF NOT EXISTS osm_coverage (
      region TEXT PRIMARY KEY,
      south REAL NOT NULL,
      west REAL NOT NULL,
      north REAL NOT NULL,
      east REAL NOT NULL,
      imported_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      avatar_path TEXT,
      home_area TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT 'intermediate'
        CHECK(level IN ('beginner','intermediate','advanced','expert')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_follows (
      follower TEXT NOT NULL,
      following TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (follower, following),
      CHECK (follower != following)
    );
    CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following);

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('friends','club','trip','custom')),
      description TEXT NOT NULL DEFAULT '',
      avatar_path TEXT,
      created_by TEXT NOT NULL,
      route_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, username)
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(username);

    CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      from_user TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at DESC);
  `);
  migrateTracksElevProfileScales(db);
  migrateNotableSectionsDescriptionEn(db);
  migratePoisRaceVisible(db);
  migratePoisCampsiteCategory(db);
  migrateUserRoutesGravelActivity(db);
  seedAppUsers(db);
}

function migratePoisRaceVisible(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(pois)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("race_visible")) {
    db.exec(`ALTER TABLE pois ADD COLUMN race_visible INTEGER NOT NULL DEFAULT 1`);
  }
}

/** OSM camp_site era in lodging; ora categoria dedicata. */
function migratePoisCampsiteCategory(db: Database.Database): void {
  db.prepare(
    `UPDATE pois SET category = 'campsite' WHERE category = 'lodging' AND sub_kind = 'camp_site'`
  ).run();
}

/** Estende CHECK activity su user_routes per includere gravel. */
function migrateUserRoutesGravelActivity(db: Database.Database): void {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_routes'`)
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'gravel'")) return;

  db.exec(`
    CREATE TABLE user_routes_gravel_mig (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      activity TEXT NOT NULL CHECK(activity IN ('road','mtb','hike','gravel')),
      geojson TEXT NOT NULL,
      waypoints_json TEXT NOT NULL DEFAULT '[]',
      length_km REAL NOT NULL DEFAULT 0,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      elev_loss_m REAL NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO user_routes_gravel_mig SELECT * FROM user_routes;
    DROP TABLE user_routes;
    ALTER TABLE user_routes_gravel_mig RENAME TO user_routes;
    CREATE INDEX IF NOT EXISTS idx_user_routes_owner ON user_routes(owner, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_routes_visibility ON user_routes(visibility, updated_at DESC);
  `);
}

/** Allinea D+/D- misurati sui vertici salvati a quelli ITRA sui trkpt grezzi (ingest). */
function migrateTracksElevProfileScales(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(tracks)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("elev_profile_gain_scale")) {
    db.exec(
      `ALTER TABLE tracks ADD COLUMN elev_profile_gain_scale REAL NOT NULL DEFAULT 1`
    );
  }
  if (!names.has("elev_profile_loss_scale")) {
    db.exec(
      `ALTER TABLE tracks ADD COLUMN elev_profile_loss_scale REAL NOT NULL DEFAULT 1`
    );
  }
}

function migrateNotableSectionsDescriptionEn(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(notable_sections)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("description_en")) {
    db.exec(
      `ALTER TABLE notable_sections ADD COLUMN description_en TEXT NOT NULL DEFAULT ''`
    );
  }
}

const GEO_CACHE_SV_PREFIX = "sv:";
const GEO_CACHE_MLY_PREFIX = "mly:";
const GEO_CACHE_HARVEST_PREFIX = "harvest:";
const GEO_CACHE_TTL_SV_SEC = 30 * 24 * 3600;
const GEO_CACHE_TTL_MLY_SEC = 24 * 3600;
const GEO_CACHE_TTL_HARVEST_SEC = 30 * 24 * 3600;

/** Cache JSON per coordinate Street View o bbox Mapillary (TTL in memoria DB). */
export function geoCacheGet(key: string): unknown | null {
  const row = getDb()
    .prepare(`SELECT payload_json, fetched_at FROM geo_api_cache WHERE cache_key = ?`)
    .get(key) as { payload_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  const ttl =
    key.startsWith(GEO_CACHE_SV_PREFIX)
      ? GEO_CACHE_TTL_SV_SEC
      : key.startsWith(GEO_CACHE_MLY_PREFIX)
        ? GEO_CACHE_TTL_MLY_SEC
        : key.startsWith(GEO_CACHE_HARVEST_PREFIX)
          ? GEO_CACHE_TTL_HARVEST_SEC
          : 7 * 24 * 3600;
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

export function geoStreetViewCacheKey(lat: number, lng: number): string {
  return `${GEO_CACHE_SV_PREFIX}${Math.round(lat * 1e5)}_${Math.round(lng * 1e5)}`;
}

export function geoMapillaryCacheKey(
  west: number,
  south: number,
  east: number,
  north: number
): string {
  const r = (x: number) => Math.round(x * 1e4);
  return `${GEO_CACHE_MLY_PREFIX}${r(west)}_${r(south)}_${r(east)}_${r(north)}`;
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
  name: string;
  gpx_path: string | null;
  coords_json: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  /** official D+ (raw GPX smoothed) / D+ misurato sulla polyline salvata (intera gara). */
  elev_profile_gain_scale?: number;
  /** official D- / D- misurato sulla polyline salvata. */
  elev_profile_loss_scale?: number;
  bbox_json: string;
  point_count: number;
  created_at: number;
};

export type CheckpointRow = {
  id: string;
  track_id: string;
  name: string;
  kind: "cp" | "finish" | "start";
  label: string | null;
  lat: number;
  lng: number;
  along_km: number;
  cutoff_utc: number | null;
  notes: string | null;
};

export type ResupplyRow = {
  id: string;
  track_id: string;
  name: string;
  along_km: number;
  leg_km: number | null;
  lat: number;
  lng: number;
  notes: string;
};

export type NotableSectionRow = {
  id: string;
  track_id: string;
  label: string;
  km_start: number;
  km_end: number;
  severity: "info" | "warn" | "hard";
  description: string;
  description_en: string;
};

export type CourseBridgeRow = {
  id: string;
  track_id: string;
  name: string;
  lat: number;
  lng: number;
  along_km: number;
  description_en: string;
};

export type PoiNoteStatus = "planned" | "visited" | "avoid" | "info";

export type PoiNoteRow = {
  id: string;
  poi_id: string;
  status: PoiNoteStatus;
  body: string;
  created_at: number;
  updated_at: number;
};

export type PoiFieldPhotoRow = {
  id: string;
  note_id: string;
  photo_path: string;
  created_at: number;
};

export type PoiNoteWithPhotos = PoiNoteRow & { photos: PoiFieldPhotoRow[] };

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
  /** 1 = mostrato in Race mode se filtri lo includono; 0 = solo Planner. */
  race_visible: number;
};

export type { RacePlanItemKind } from "./race-plan-types";
export { RACE_PLAN_ITEM_KINDS } from "./race-plan-types";

export type RacePlanRow = {
  id: string;
  track_id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

export type RacePlanItemRow = {
  id: string;
  plan_id: string;
  km_start: number;
  km_end: number;
  kind: RacePlanItemKind;
  title: string;
  body: string;
  est_hours: number | null;
  avoid_night: number;
  created_at: number;
  updated_at: number;
};

export type RacePlanWithItems = RacePlanRow & { items: RacePlanItemRow[] };

export type TrackSurfaceSegmentRow = {
  id: string;
  track_id: string;
  km_start: number;
  km_end: number;
  surface: TrackSurfaceKind;
  source: string;
};

export type AuthMagicLinkRow = {
  id: string;
  email: string;
  token_hash: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
};

export type AuthSessionRow = {
  id: string;
  email: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
};

export function listTrackSurfaceSegments(trackId: string): TrackSurfaceSegmentRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM track_surface_segments WHERE track_id = ? ORDER BY km_start ASC`
    )
    .all(trackId) as TrackSurfaceSegmentRow[];
}

export function replaceTrackSurfaceSegments(
  trackId: string,
  rows: Array<{
    id: string;
    km_start: number;
    km_end: number;
    surface: TrackSurfaceKind;
    source?: string;
  }>
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM track_surface_segments WHERE track_id = ?`).run(trackId);
    const ins = db.prepare(
      `INSERT INTO track_surface_segments (id, track_id, km_start, km_end, surface, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const r of rows) {
      ins.run(
        r.id,
        trackId,
        r.km_start,
        r.km_end,
        r.surface,
        r.source ?? "osm_overpass"
      );
    }
  });
  tx();
}

/** Clamp e ordina km su traccia [0, lengthKm]. */
export function normalizeRacePlanKms(
  kmStart: number,
  kmEnd: number,
  lengthKm: number
): { km_start: number; km_end: number } {
  const L = Math.max(0, lengthKm);
  let a = Number.isFinite(kmStart) ? kmStart : 0;
  let b = Number.isFinite(kmEnd) ? kmEnd : a;
  a = Math.min(L, Math.max(0, a));
  b = Math.min(L, Math.max(0, b));
  if (b < a) [a, b] = [b, a];
  return { km_start: a, km_end: b };
}

export function listRacePlans(trackId: string): RacePlanRow[] {
  return getDb()
    .prepare(`SELECT * FROM race_plans WHERE track_id = ? ORDER BY created_at ASC`)
    .all(trackId) as RacePlanRow[];
}

export function getRacePlan(planId: string): RacePlanRow | undefined {
  return getDb().prepare(`SELECT * FROM race_plans WHERE id = ?`).get(planId) as RacePlanRow | undefined;
}

export function listRacePlanItems(planId: string): RacePlanItemRow[] {
  return getDb()
    .prepare(`SELECT * FROM race_plan_items WHERE plan_id = ? ORDER BY km_start ASC, id ASC`)
    .all(planId) as RacePlanItemRow[];
}

export function listRacePlansWithItems(trackId: string): RacePlanWithItems[] {
  const plans = listRacePlans(trackId);
  return plans.map((p) => ({ ...p, items: listRacePlanItems(p.id) }));
}

export function insertRacePlan(input: {
  id: string;
  track_id: string;
  name: string;
  created_at: number;
  updated_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO race_plans (id, track_id, name, created_at, updated_at) VALUES (@id, @track_id, @name, @created_at, @updated_at)`
    )
    .run(input);
}

export function updateRacePlan(planId: string, name: string, updated_at: number): void {
  getDb().prepare(`UPDATE race_plans SET name = ?, updated_at = ? WHERE id = ?`).run(name, updated_at, planId);
}

export function deleteRacePlan(planId: string): void {
  getDb().prepare(`DELETE FROM race_plans WHERE id = ?`).run(planId);
}

export function insertRacePlanItem(input: {
  id: string;
  plan_id: string;
  km_start: number;
  km_end: number;
  kind: RacePlanItemKind;
  title: string;
  body: string;
  est_hours: number | null;
  avoid_night: 0 | 1;
  created_at: number;
  updated_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO race_plan_items (
        id, plan_id, km_start, km_end, kind, title, body, est_hours, avoid_night, created_at, updated_at
      ) VALUES (
        @id, @plan_id, @km_start, @km_end, @kind, @title, @body, @est_hours, @avoid_night, @created_at, @updated_at
      )`
    )
    .run(input);
}

export function updateRacePlanItem(
  itemId: string,
  patch: {
    km_start: number;
    km_end: number;
    kind: RacePlanItemKind;
    title: string;
    body: string;
    est_hours: number | null;
    avoid_night: 0 | 1;
    updated_at: number;
  }
): void {
  getDb()
    .prepare(
      `UPDATE race_plan_items SET
        km_start = @km_start,
        km_end = @km_end,
        kind = @kind,
        title = @title,
        body = @body,
        est_hours = @est_hours,
        avoid_night = @avoid_night,
        updated_at = @updated_at
      WHERE id = @id`
    )
    .run({ ...patch, id: itemId });
}

export function getRacePlanItem(itemId: string): RacePlanItemRow | undefined {
  return getDb().prepare(`SELECT * FROM race_plan_items WHERE id = ?`).get(itemId) as RacePlanItemRow | undefined;
}

export function deleteRacePlanItem(itemId: string): void {
  getDb().prepare(`DELETE FROM race_plan_items WHERE id = ?`).run(itemId);
}

export function listTracks(): TrackRow[] {
  return getDb().prepare(`SELECT * FROM tracks ORDER BY created_at DESC`).all() as TrackRow[];
}

export function getTrack(id: string): TrackRow | undefined {
  return getDb().prepare(`SELECT * FROM tracks WHERE id = ?`).get(id) as TrackRow | undefined;
}

export function getFirstTrack(): TrackRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM tracks ORDER BY created_at DESC LIMIT 1`)
    .get() as TrackRow | undefined;
}

/** Elimina traccia e dati collegati (ON DELETE CASCADE). */
export function deleteTrack(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM tracks WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function listCheckpoints(trackId: string): CheckpointRow[] {
  return getDb()
    .prepare(`SELECT * FROM checkpoints WHERE track_id = ? ORDER BY along_km ASC`)
    .all(trackId) as CheckpointRow[];
}

export function listResupply(trackId: string): ResupplyRow[] {
  return getDb()
    .prepare(`SELECT * FROM official_resupply WHERE track_id = ? ORDER BY along_km ASC`)
    .all(trackId) as ResupplyRow[];
}

export function listNotableSections(trackId: string): NotableSectionRow[] {
  return getDb()
    .prepare(`SELECT * FROM notable_sections WHERE track_id = ? ORDER BY km_start ASC`)
    .all(trackId) as NotableSectionRow[];
}

export function listCourseBridges(trackId: string): CourseBridgeRow[] {
  return getDb()
    .prepare(`SELECT * FROM course_bridges WHERE track_id = ? ORDER BY along_km ASC`)
    .all(trackId) as CourseBridgeRow[];
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

export function getPoiNoteByPoiId(poiId: string): PoiNoteRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM notes WHERE poi_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .get(poiId) as PoiNoteRow | undefined;
}

export function listPoiNotesForTrack(trackId: string): PoiNoteWithPhotos[] {
  const notes = getDb()
    .prepare(
      `SELECT n.* FROM notes n
       INNER JOIN pois p ON p.id = n.poi_id
       WHERE p.track_id = ?
       ORDER BY n.updated_at DESC`
    )
    .all(trackId) as PoiNoteRow[];
  const photoStmt = getDb().prepare(
    `SELECT * FROM poi_field_photos WHERE note_id = ? ORDER BY created_at ASC`
  );
  return notes.map((n) => ({
    ...n,
    photos: photoStmt.all(n.id) as PoiFieldPhotoRow[],
  }));
}

import { normalizeSurveyStatus } from "./poi-survey";
export { normalizeSurveyStatus, isPoiSurveyVerified } from "./poi-survey";

export function listSurveyPoiIdsByStatus(trackId: string): {
  verified: string[];
  avoid: string[];
} {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT n.poi_id, n.status FROM notes n
       INNER JOIN pois p ON p.id = n.poi_id
       WHERE p.track_id = ? AND n.status IN ('info', 'visited', 'avoid')`
    )
    .all(trackId) as { poi_id: string; status: PoiNoteStatus }[];
  const verified: string[] = [];
  const avoid: string[] = [];
  for (const r of rows) {
    const s = normalizeSurveyStatus(r.status);
    if (s === "info") verified.push(r.poi_id);
    else if (s === "avoid") avoid.push(r.poi_id);
  }
  return { verified, avoid };
}

export function upsertPoiNote(input: {
  id: string;
  poi_id: string;
  status: PoiNoteStatus;
  body: string;
  created_at: number;
  updated_at: number;
}): PoiNoteRow {
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM notes WHERE poi_id = ?`)
    .get(input.poi_id) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE notes SET status = ?, body = ?, updated_at = ? WHERE id = ?`
    ).run(input.status, input.body, input.updated_at, existing.id);
    return db.prepare(`SELECT * FROM notes WHERE id = ?`).get(existing.id) as PoiNoteRow;
  }
  db.prepare(
    `INSERT INTO notes (id, poi_id, status, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.poi_id,
    input.status,
    input.body,
    input.created_at,
    input.updated_at
  );
  return db.prepare(`SELECT * FROM notes WHERE id = ?`).get(input.id) as PoiNoteRow;
}

export function insertPoiFieldPhoto(input: {
  id: string;
  note_id: string;
  photo_path: string;
  created_at: number;
}): PoiFieldPhotoRow {
  getDb()
    .prepare(
      `INSERT INTO poi_field_photos (id, note_id, photo_path, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.id, input.note_id, input.photo_path, input.created_at);
  return getDb()
    .prepare(`SELECT * FROM poi_field_photos WHERE id = ?`)
    .get(input.id) as PoiFieldPhotoRow;
}

export function listPhotosForNote(noteId: string): PoiFieldPhotoRow[] {
  return getDb()
    .prepare(`SELECT * FROM poi_field_photos WHERE note_id = ? ORDER BY created_at ASC`)
    .all(noteId) as PoiFieldPhotoRow[];
}

export type TrackStreetViewPointRow = {
  track_id: string;
  pano_id: string;
  lat: number;
  lng: number;
  along_km: number;
  detour_m: number;
  copyright: string | null;
  sample_lat: number;
  sample_lng: number;
  fetched_at: number;
};

function streetViewRowToItem(row: TrackStreetViewPointRow): StreetViewAlongItem {
  return {
    pano_id: row.pano_id,
    lat: row.lat,
    lng: row.lng,
    along_km: row.along_km,
    detour_m: row.detour_m,
    copyright: row.copyright,
    sample_lat: row.sample_lat,
    sample_lng: row.sample_lng,
    maps_url: googleMapsStreetViewLayerUrl(row.lat, row.lng, row.pano_id),
  };
}

/** Punti Street View salvati per la traccia nell’intervallo di km (inclusivo). */
export function listTrackStreetViewPointsInKmRange(
  trackId: string,
  kmMin: number,
  kmMax: number
): StreetViewAlongItem[] {
  const lo = Math.min(kmMin, kmMax);
  const hi = Math.max(kmMin, kmMax);
  const rows = getDb()
    .prepare(
      `SELECT * FROM track_street_view_points
       WHERE track_id = ? AND along_km >= ? AND along_km <= ?
       ORDER BY along_km ASC`
    )
    .all(trackId, lo, hi) as TrackStreetViewPointRow[];
  return rows.map(streetViewRowToItem);
}

/** Inserisce o aggiorna punti Street View (stesso pano_id = upsert). */
export function upsertTrackStreetViewPoints(trackId: string, items: StreetViewAlongItem[]): void {
  if (items.length === 0) return;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(
    `INSERT INTO track_street_view_points (
       track_id, pano_id, lat, lng, along_km, detour_m, copyright, sample_lat, sample_lng, fetched_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(track_id, pano_id) DO UPDATE SET
       lat = excluded.lat,
       lng = excluded.lng,
       along_km = excluded.along_km,
       detour_m = excluded.detour_m,
       copyright = excluded.copyright,
       sample_lat = excluded.sample_lat,
       sample_lng = excluded.sample_lng,
       fetched_at = excluded.fetched_at`
  );
  const tx = db.transaction(() => {
    for (const it of items) {
      stmt.run(
        trackId,
        it.pano_id,
        it.lat,
        it.lng,
        it.along_km,
        it.detour_m,
        it.copyright ?? null,
        it.sample_lat,
        it.sample_lng,
        now
      );
    }
  });
  tx();
}

export function insertAuthMagicLink(input: {
  id: string;
  email: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO auth_magic_links (id, email, token_hash, expires_at, created_at)
       VALUES (@id, @email, @token_hash, @expires_at, @created_at)`
    )
    .run(input);
}

export function getAuthMagicLinkByTokenHash(tokenHash: string): AuthMagicLinkRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM auth_magic_links WHERE token_hash = ?`)
    .get(tokenHash) as AuthMagicLinkRow | undefined;
}

export function markAuthMagicLinkUsed(id: string, usedAt: number): void {
  getDb().prepare(`UPDATE auth_magic_links SET used_at = ? WHERE id = ?`).run(usedAt, id);
}

export function pruneAuthMagicLinks(now: number): void {
  getDb()
    .prepare(`DELETE FROM auth_magic_links WHERE expires_at <= ? OR used_at IS NOT NULL`)
    .run(now);
}

export function insertAuthSession(input: {
  id: string;
  email: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO auth_sessions (id, email, token_hash, expires_at, created_at)
       VALUES (@id, @email, @token_hash, @expires_at, @created_at)`
    )
    .run(input);
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

/** SHA-256 hex per password utente (compatibile con auth.ts). */
export function hashAppPassword(password: string): string {
  return crypto.createHash("sha256").update(password, "utf8").digest("hex");
}

const SEED_APP_USERS: Readonly<
  Record<string, { password: string; role: "user" | "admin" }>
> = {
  ago: { password: "hellenicago26", role: "admin" },
  ale: { password: "hellenicale26", role: "user" },
  gala: { password: "hellenicgala26", role: "user" },
  babbo: { password: "hellenicbabbo26", role: "user" },
  marti: { password: "helenicmarti2026", role: "user" },
};

function seedAppUsers(db: Database.Database): void {
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM app_users`).get() as { n: number }).n;
  if (count > 0) return;
  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO app_users (username, password_hash, role, active, created_at)
     VALUES (?, ?, ?, 1, ?)`
  );
  for (const [username, { password, role }] of Object.entries(SEED_APP_USERS)) {
    ins.run(username, hashAppPassword(password), role, now);
  }
}

export type AppUserRole = "user" | "admin";

export type AppUserRow = {
  username: string;
  password_hash: string;
  role: AppUserRole;
  active: number;
  created_at: number;
};

export type UserRouteActivity = "road" | "mtb" | "hike" | "gravel";

export type UserRouteVisibility = "private" | "public";

export type UserRouteRow = {
  id: string;
  owner: string;
  name: string;
  activity: UserRouteActivity;
  geojson: string;
  waypoints_json: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  visibility: UserRouteVisibility;
  created_at: number;
  updated_at: number;
};

export function listAppUsers(): AppUserRow[] {
  return getDb()
    .prepare(`SELECT * FROM app_users ORDER BY username ASC`)
    .all() as AppUserRow[];
}

export function getAppUser(username: string): AppUserRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM app_users WHERE username = ?`)
    .get(username.trim().toLowerCase()) as AppUserRow | undefined;
}

export function upsertAppUser(input: {
  username: string;
  password_hash: string;
  role: AppUserRole;
  active: 0 | 1;
  created_at?: number;
}): void {
  const u = input.username.trim().toLowerCase();
  const existing = getAppUser(u);
  const now = input.created_at ?? Date.now();
  if (existing) {
    getDb()
      .prepare(
        `UPDATE app_users SET password_hash = ?, role = ?, active = ? WHERE username = ?`
      )
      .run(input.password_hash, input.role, input.active, u);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO app_users (username, password_hash, role, active, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(u, input.password_hash, input.role, input.active, now);
}

export function deleteAppUser(username: string): boolean {
  const res = getDb().prepare(`DELETE FROM app_users WHERE username = ?`).run(username.trim().toLowerCase());
  return res.changes > 0;
}

export function countAppUsersByRole(role: AppUserRole): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM app_users WHERE role = ? AND active = 1`)
    .get(role) as { n: number };
  return r.n;
}

export function listRoutesForOwner(owner: string): UserRouteRow[] {
  return getDb()
    .prepare(`SELECT * FROM user_routes WHERE owner = ? ORDER BY updated_at DESC`)
    .all(owner.trim().toLowerCase()) as UserRouteRow[];
}

export function listPublicRoutes(): UserRouteRow[] {
  return getDb()
    .prepare(`SELECT * FROM user_routes WHERE visibility = 'public' ORDER BY updated_at DESC`)
    .all() as UserRouteRow[];
}

export function getUserRoute(id: string): UserRouteRow | undefined {
  return getDb().prepare(`SELECT * FROM user_routes WHERE id = ?`).get(id) as UserRouteRow | undefined;
}

export function insertUserRoute(input: {
  id: string;
  owner: string;
  name: string;
  activity: UserRouteActivity;
  geojson: string;
  waypoints_json: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  visibility: UserRouteVisibility;
  created_at: number;
  updated_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO user_routes (
        id, owner, name, activity, geojson, waypoints_json,
        length_km, elev_gain_m, elev_loss_m, visibility, created_at, updated_at
      ) VALUES (
        @id, @owner, @name, @activity, @geojson, @waypoints_json,
        @length_km, @elev_gain_m, @elev_loss_m, @visibility, @created_at, @updated_at
      )`
    )
    .run({ ...input, owner: input.owner.trim().toLowerCase() });
}

export function updateUserRoute(
  id: string,
  patch: {
    name?: string;
    activity?: UserRouteActivity;
    geojson?: string;
    waypoints_json?: string;
    length_km?: number;
    elev_gain_m?: number;
    elev_loss_m?: number;
    visibility?: UserRouteVisibility;
    updated_at: number;
  }
): void {
  const row = getUserRoute(id);
  if (!row) return;
  getDb()
    .prepare(
      `UPDATE user_routes SET
        name = @name,
        activity = @activity,
        geojson = @geojson,
        waypoints_json = @waypoints_json,
        length_km = @length_km,
        elev_gain_m = @elev_gain_m,
        elev_loss_m = @elev_loss_m,
        visibility = @visibility,
        updated_at = @updated_at
      WHERE id = @id`
    )
    .run({
      id,
      name: patch.name ?? row.name,
      activity: patch.activity ?? row.activity,
      geojson: patch.geojson ?? row.geojson,
      waypoints_json: patch.waypoints_json ?? row.waypoints_json,
      length_km: patch.length_km ?? row.length_km,
      elev_gain_m: patch.elev_gain_m ?? row.elev_gain_m,
      elev_loss_m: patch.elev_loss_m ?? row.elev_loss_m,
      visibility: patch.visibility ?? row.visibility,
      updated_at: patch.updated_at,
    });
}

export function deleteUserRoute(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM user_routes WHERE id = ?`).run(id);
  return res.changes > 0;
}

/* ---------------- OSM POI locale (snapshot Italia) ---------------- */

export type OsmPoiRow = {
  osm_type: string;
  osm_id: number;
  category: PoiCategory;
  sub_kind: string;
  lat: number;
  lng: number;
  tags_json: string;
};

export type OsmCoverageRow = {
  region: string;
  south: number;
  west: number;
  north: number;
  east: number;
  imported_at: number;
};

export function localPoiCount(): number {
  const r = getDb().prepare(`SELECT COUNT(*) AS n FROM osm_poi`).get() as { n: number };
  return r.n;
}

export function getLocalCoverage(): OsmCoverageRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM osm_coverage ORDER BY imported_at DESC LIMIT 1`)
    .get() as OsmCoverageRow | undefined;
}

/** True se il bbox query e interamente dentro la copertura importata. */
export function localCoverageContainsBbox(
  south: number,
  west: number,
  north: number,
  east: number
): boolean {
  const cov = getLocalCoverage();
  if (!cov) return false;
  return cov.south <= south && cov.west <= west && cov.north >= north && cov.east >= east;
}

export function localCoverageContainsAround(lat: number, lng: number, radiusM: number): boolean {
  const deltaLat = radiusM / 111_320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const deltaLng = radiusM / (111_320 * Math.max(0.2, Math.abs(cosLat)));
  return localCoverageContainsBbox(
    lat - deltaLat,
    lng - deltaLng,
    lat + deltaLat,
    lng + deltaLng
  );
}

export function resetLocalOsmStore(): void {
  const db = getDb();
  db.exec(`DELETE FROM osm_poi_rtree; DELETE FROM osm_poi; DELETE FROM osm_coverage;`);
}

export function setLocalOsmCoverage(input: {
  region: string;
  south: number;
  west: number;
  north: number;
  east: number;
  imported_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO osm_coverage (region, south, west, north, east, imported_at)
       VALUES (@region, @south, @west, @north, @east, @imported_at)
       ON CONFLICT(region) DO UPDATE SET
         south = excluded.south,
         west = excluded.west,
         north = excluded.north,
         east = excluded.east,
         imported_at = excluded.imported_at`
    )
    .run(input);
}

export function insertLocalOsmPoiBatch(
  rows: Array<{
    osm_type: string;
    osm_id: number;
    category: PoiCategory;
    sub_kind: string;
    lat: number;
    lng: number;
    tags: Record<string, string>;
  }>
): void {
  if (rows.length === 0) return;
  const db = getDb();
  const insPoi = db.prepare(
    `INSERT INTO osm_poi (osm_type, osm_id, category, sub_kind, lat, lng, tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insRtree = db.prepare(
    `INSERT OR REPLACE INTO osm_poi_rtree (id, minLat, maxLat, minLng, maxLng)
     VALUES (?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      const info = insPoi.run(
        r.osm_type,
        r.osm_id,
        r.category,
        r.sub_kind,
        r.lat,
        r.lng,
        JSON.stringify(r.tags)
      );
      const rowid = Number(info.lastInsertRowid);
      insRtree.run(rowid, r.lat, r.lat, r.lng, r.lng);
    }
  });
  tx();
}

function localPoiCategoryClause(categories: PoiCategory[] | null): {
  sql: string;
  params: PoiCategory[];
} {
  if (!categories || categories.length === 0) return { sql: "", params: [] };
  return {
    sql: ` AND p.category IN (${categories.map(() => "?").join(",")})`,
    params: categories,
  };
}

export function queryLocalPoisInBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  categories: PoiCategory[] | null
): OsmPoiRow[] {
  const cat = localPoiCategoryClause(categories);
  const sql = `SELECT p.osm_type, p.osm_id, p.category, p.sub_kind, p.lat, p.lng, p.tags_json
    FROM osm_poi p
    INNER JOIN osm_poi_rtree r ON r.id = p.rowid
    WHERE r.maxLat >= ? AND r.minLat <= ?
      AND r.maxLng >= ? AND r.minLng <= ?${cat.sql}`;
  return getDb()
    .prepare(sql)
    .all(south, north, west, east, ...cat.params) as OsmPoiRow[];
}

export function queryLocalPoisAround(
  lat: number,
  lng: number,
  radiusM: number,
  categories: PoiCategory[] | null
): OsmPoiRow[] {
  const deltaLat = radiusM / 111_320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const deltaLng = radiusM / (111_320 * Math.max(0.2, Math.abs(cosLat)));
  const rows = queryLocalPoisInBbox(
    lat - deltaLat,
    lng - deltaLng,
    lat + deltaLat,
    lng + deltaLng,
    categories
  );
  const r2 = radiusM * radiusM;
  return rows.filter((p) => {
    const dLat = (p.lat - lat) * 111_320;
    const dLng = (p.lng - lng) * 111_320 * cosLat;
    return dLat * dLat + dLng * dLng <= r2;
  });
}

export function countLocalPoisByCategory(): Array<{ category: string; n: number }> {
  return getDb()
    .prepare(`SELECT category, COUNT(*) AS n FROM osm_poi GROUP BY category ORDER BY n DESC`)
    .all() as Array<{ category: string; n: number }>;
}

/* ---------------- Profilo, follow, gruppi ---------------- */

export type ProfileLevel = "beginner" | "intermediate" | "advanced" | "expert";

export type UserProfileRow = {
  username: string;
  display_name: string;
  bio: string;
  avatar_path: string | null;
  home_area: string;
  level: ProfileLevel;
  created_at: number;
  updated_at: number;
};

export type GroupType = "friends" | "club" | "trip" | "custom";

export type GroupMemberRole = "owner" | "admin" | "member";

export type GroupRow = {
  id: string;
  name: string;
  type: GroupType;
  description: string;
  avatar_path: string | null;
  created_by: string;
  route_id: string | null;
  created_at: number;
  updated_at: number;
};

export type GroupMemberRow = {
  group_id: string;
  username: string;
  role: GroupMemberRole;
  joined_at: number;
};

export type GroupMessageRow = {
  id: string;
  group_id: string;
  from_user: string;
  body: string;
  created_at: number;
};

function normalizeUser(username: string): string {
  return username.trim().toLowerCase();
}

export function getUserProfile(username: string): UserProfileRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM user_profiles WHERE username = ?`)
    .get(normalizeUser(username)) as UserProfileRow | undefined;
}

export function ensureUserProfile(username: string): UserProfileRow {
  const u = normalizeUser(username);
  const existing = getUserProfile(u);
  if (existing) return existing;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO user_profiles (username, display_name, bio, avatar_path, home_area, level, created_at, updated_at)
       VALUES (?, '', '', NULL, '', 'intermediate', ?, ?)`
    )
    .run(u, now, now);
  return getUserProfile(u)!;
}

export function upsertUserProfile(input: {
  username: string;
  display_name?: string;
  bio?: string;
  avatar_path?: string | null;
  home_area?: string;
  level?: ProfileLevel;
}): UserProfileRow {
  const u = normalizeUser(input.username);
  ensureUserProfile(u);
  const row = getUserProfile(u)!;
  const now = Date.now();
  getDb()
    .prepare(
      `UPDATE user_profiles SET
        display_name = @display_name,
        bio = @bio,
        avatar_path = @avatar_path,
        home_area = @home_area,
        level = @level,
        updated_at = @updated_at
      WHERE username = @username`
    )
    .run({
      username: u,
      display_name: input.display_name ?? row.display_name,
      bio: input.bio ?? row.bio,
      avatar_path: input.avatar_path !== undefined ? input.avatar_path : row.avatar_path,
      home_area: input.home_area ?? row.home_area,
      level: input.level ?? row.level,
      updated_at: now,
    });
  return getUserProfile(u)!;
}

export function followUser(follower: string, following: string): boolean {
  const f = normalizeUser(follower);
  const t = normalizeUser(following);
  if (f === t) return false;
  if (!getAppUser(t)) return false;
  const now = Date.now();
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_follows (follower, following, created_at) VALUES (?, ?, ?)`
    )
    .run(f, t, now);
  return res.changes > 0;
}

export function unfollowUser(follower: string, following: string): boolean {
  const res = getDb()
    .prepare(`DELETE FROM user_follows WHERE follower = ? AND following = ?`)
    .run(normalizeUser(follower), normalizeUser(following));
  return res.changes > 0;
}

export function isFollowing(follower: string, following: string): boolean {
  const r = getDb()
    .prepare(`SELECT 1 AS n FROM user_follows WHERE follower = ? AND following = ?`)
    .get(normalizeUser(follower), normalizeUser(following)) as { n: number } | undefined;
  return !!r;
}

export function countFollowers(username: string): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM user_follows WHERE following = ?`)
    .get(normalizeUser(username)) as { n: number };
  return r.n;
}

export function countFollowing(username: string): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM user_follows WHERE follower = ?`)
    .get(normalizeUser(username)) as { n: number };
  return r.n;
}

export function listFollowing(username: string): string[] {
  return (
    getDb()
      .prepare(`SELECT following FROM user_follows WHERE follower = ? ORDER BY created_at DESC`)
      .all(normalizeUser(username)) as Array<{ following: string }>
  ).map((r) => r.following);
}

export function listFollowers(username: string): string[] {
  return (
    getDb()
      .prepare(`SELECT follower FROM user_follows WHERE following = ? ORDER BY created_at DESC`)
      .all(normalizeUser(username)) as Array<{ follower: string }>
  ).map((r) => r.follower);
}

export function countPublicRoutesForOwner(owner: string): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM user_routes WHERE owner = ? AND visibility = 'public'`)
    .get(normalizeUser(owner)) as { n: number };
  return r.n;
}

export function getGroup(id: string): GroupRow | undefined {
  return getDb().prepare(`SELECT * FROM groups WHERE id = ?`).get(id) as GroupRow | undefined;
}

export function insertGroup(input: {
  id: string;
  name: string;
  type: GroupType;
  description?: string;
  avatar_path?: string | null;
  created_by: string;
  route_id?: string | null;
  created_at: number;
  updated_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO groups (id, name, type, description, avatar_path, created_by, route_id, created_at, updated_at)
       VALUES (@id, @name, @type, @description, @avatar_path, @created_by, @route_id, @created_at, @updated_at)`
    )
    .run({
      ...input,
      description: input.description ?? "",
      avatar_path: input.avatar_path ?? null,
      created_by: normalizeUser(input.created_by),
      route_id: input.route_id ?? null,
    });
}

export function updateGroup(
  id: string,
  patch: {
    name?: string;
    type?: GroupType;
    description?: string;
    avatar_path?: string | null;
    route_id?: string | null;
    updated_at: number;
  }
): void {
  const row = getGroup(id);
  if (!row) return;
  getDb()
    .prepare(
      `UPDATE groups SET
        name = @name,
        type = @type,
        description = @description,
        avatar_path = @avatar_path,
        route_id = @route_id,
        updated_at = @updated_at
      WHERE id = @id`
    )
    .run({
      id,
      name: patch.name ?? row.name,
      type: patch.type ?? row.type,
      description: patch.description ?? row.description,
      avatar_path: patch.avatar_path !== undefined ? patch.avatar_path : row.avatar_path,
      route_id: patch.route_id !== undefined ? patch.route_id : row.route_id,
      updated_at: patch.updated_at,
    });
}

export function deleteGroup(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM groups WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function addGroupMember(input: {
  group_id: string;
  username: string;
  role: GroupMemberRole;
  joined_at: number;
}): boolean {
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO group_members (group_id, username, role, joined_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.group_id, normalizeUser(input.username), input.role, input.joined_at);
  return res.changes > 0;
}

export function removeGroupMember(groupId: string, username: string): boolean {
  const res = getDb()
    .prepare(`DELETE FROM group_members WHERE group_id = ? AND username = ?`)
    .run(groupId, normalizeUser(username));
  return res.changes > 0;
}

export function getGroupMember(groupId: string, username: string): GroupMemberRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM group_members WHERE group_id = ? AND username = ?`)
    .get(groupId, normalizeUser(username)) as GroupMemberRow | undefined;
}

export function listGroupMembers(groupId: string): GroupMemberRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM group_members WHERE group_id = ? ORDER BY
        CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        joined_at ASC`
    )
    .all(groupId) as GroupMemberRow[];
}

export function listGroupsForUser(username: string): GroupRow[] {
  const u = normalizeUser(username);
  return getDb()
    .prepare(
      `SELECT g.* FROM groups g
       INNER JOIN group_members m ON m.group_id = g.id
       WHERE m.username = ?
       ORDER BY g.updated_at DESC`
    )
    .all(u) as GroupRow[];
}

export function insertGroupMessage(input: {
  id: string;
  group_id: string;
  from_user: string;
  body: string;
  created_at: number;
}): GroupMessageRow {
  getDb()
    .prepare(
      `INSERT INTO group_messages (id, group_id, from_user, body, created_at)
       VALUES (@id, @group_id, @from_user, @body, @created_at)`
    )
    .run({ ...input, from_user: normalizeUser(input.from_user) });
  getDb()
    .prepare(`UPDATE groups SET updated_at = ? WHERE id = ?`)
    .run(input.created_at, input.group_id);
  return getDb()
    .prepare(`SELECT * FROM group_messages WHERE id = ?`)
    .get(input.id) as GroupMessageRow;
}

export function listGroupMessages(
  groupId: string,
  opts?: { since?: number; limit?: number }
): GroupMessageRow[] {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  if (opts?.since) {
    return getDb()
      .prepare(
        `SELECT * FROM group_messages WHERE group_id = ? AND created_at > ?
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(groupId, opts.since, limit) as GroupMessageRow[];
  }
  return getDb()
    .prepare(
      `SELECT * FROM group_messages WHERE group_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(groupId, limit)
    .reverse() as GroupMessageRow[];
}

export function getLastGroupMessage(groupId: string): GroupMessageRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(groupId) as GroupMessageRow | undefined;
}

export function isGroupAdmin(groupId: string, username: string): boolean {
  const m = getGroupMember(groupId, username);
  return m?.role === "owner" || m?.role === "admin";
}

export function isGroupOwner(groupId: string, username: string): boolean {
  const m = getGroupMember(groupId, username);
  return m?.role === "owner";
}
