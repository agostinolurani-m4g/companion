import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { StreetViewAlongItem } from "./along-media-types";
import { googleMapsStreetViewLayerUrl } from "./gmaps-url";
import type { RacePlanItemKind } from "./race-plan-types";
import type { TrackSurfaceKind } from "./surface-osm";
import {
  emptyActivityCounts,
  USER_ROUTE_ACTIVITIES,
  USER_ROUTE_ACTIVITY_CHECK_IN,
  type UserRouteActivity,
} from "./sports";
import {
  expiresAtForKind,
  renewExpiresAt,
  REPORT_KIND_SEVERITY,
  type FieldReportKind,
} from "./field-reports";
import { migrateOutdoorStore } from "./outdoor/store";
import { migrateActivitiesStore } from "./activities/store";
import { activityFilterSql } from "./sport-affinity";

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
  // Più processi (server + script di import) possono scrivere: attendi invece di fallire.
  db.pragma("busy_timeout = 15000");
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

    -- Tesserati Amaro entrati dall'area tesserati (SSO): member_id Amaro -> utente locale.
    CREATE TABLE IF NOT EXISTS amaro_members (
      member_id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      last_login_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_routes (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      activity TEXT NOT NULL CHECK(activity IN (${USER_ROUTE_ACTIVITY_CHECK_IN})),
      geojson TEXT NOT NULL,
      waypoints_json TEXT NOT NULL DEFAULT '[]',
      length_km REAL NOT NULL DEFAULT 0,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      elev_loss_m REAL NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
      source TEXT,
      source_url TEXT,
      license TEXT,
      external_id TEXT,
      meta_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_routes_owner ON user_routes(owner, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_routes_visibility ON user_routes(visibility, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_routes_source_ext ON user_routes(source, external_id);

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
  migrateUserRoutesSkiActivity(db);
  migrateUserRoutesNineActivities(db);
  migrateUserRoutesSourceMeta(db);
  migrateUserRoutesActivityCheck(db);
  migrateUserRoutesBbox(db);
  migrateUserProfilesTrust(db);
  migrateV2SocialTables(db);
  migrateFieldReportsExpanded(db);
  migrateConditionsCache(db);
  migrateSkiOutingsToOutings(db);
  migrateOutingsPlanReport(db);
  migrateOutdoorStore(db);
  migrateActivitiesStore(db);
  seedAppUsers(db);
}

function migratePoisRaceVisible(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(pois)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("race_visible")) {
    db.exec(`ALTER TABLE pois ADD COLUMN race_visible INTEGER NOT NULL DEFAULT 1`);
  }
}

function migrateUserProfilesTrust(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(user_profiles)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("trust_score")) {
    db.exec(`ALTER TABLE user_profiles ADD COLUMN trust_score REAL NOT NULL DEFAULT 0`);
  }
  if (!names.has("trust_tier")) {
    db.exec(
      `ALTER TABLE user_profiles ADD COLUMN trust_tier TEXT NOT NULL DEFAULT 'new' CHECK(trust_tier IN ('new','reliable','expert'))`,
    );
  }
}

function migrateV2SocialTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_photos (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      lng REAL NOT NULL,
      lat REAL NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      photo_path TEXT NOT NULL,
      route_id TEXT,
      outing_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_photos_owner ON user_photos(owner, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_photos_bbox ON user_photos(lat, lng);

    CREATE TABLE IF NOT EXISTS field_reports (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      lng REAL NOT NULL,
      lat REAL NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN (
        'avalanche','road_closed','steep','bridge_down',
        'trail_blocked','water','other'
      )),
      description TEXT NOT NULL DEFAULT '',
      route_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')),
      confirmation_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_field_reports_status ON field_reports(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_field_reports_author ON field_reports(author);

    CREATE TABLE IF NOT EXISTS field_report_confirmations (
      report_id TEXT NOT NULL REFERENCES field_reports(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (report_id, username)
    );

    CREATE TABLE IF NOT EXISTS group_invites (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, username)
    );
    CREATE INDEX IF NOT EXISTS idx_group_invites_user ON group_invites(username, status);
  `);
}

function migrateFieldReportsExpanded(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(field_reports)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("severity")) {
    db.exec(`ALTER TABLE field_reports ADD COLUMN severity INTEGER NOT NULL DEFAULT 1`);
  }
  if (!names.has("expires_at")) {
    db.exec(`ALTER TABLE field_reports ADD COLUMN expires_at INTEGER`);
  }
  if (!names.has("photo_id")) {
    db.exec(`ALTER TABLE field_reports ADD COLUMN photo_id TEXT`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS field_report_resolve_votes (
      report_id TEXT NOT NULL REFERENCES field_reports(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (report_id, username)
    );
  `);

  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'field_reports'`)
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'road_damaged'")) return;

  db.exec(`
    CREATE TABLE field_reports_kind_mig (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      lng REAL NOT NULL,
      lat REAL NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN (
        'avalanche','cornice','ice','snow_conditions','rockfall',
        'road_closed','road_damaged','trail_decommissioned','trail_blocked',
        'bridge_down','water','storm','ferrata_damage','livestock_dogs','steep','other'
      )),
      description TEXT NOT NULL DEFAULT '',
      route_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')),
      confirmation_count INTEGER NOT NULL DEFAULT 0,
      severity INTEGER NOT NULL DEFAULT 1,
      expires_at INTEGER,
      photo_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO field_reports_kind_mig (
      id, author, lng, lat, kind, description, route_id, status, confirmation_count,
      severity, expires_at, photo_id, created_at, updated_at
    )
    SELECT
      id, author, lng, lat, kind, description, route_id, status, confirmation_count,
      COALESCE(severity, 1), expires_at, photo_id, created_at, updated_at
    FROM field_reports;
    DROP TABLE field_reports;
    ALTER TABLE field_reports_kind_mig RENAME TO field_reports;
    CREATE INDEX IF NOT EXISTS idx_field_reports_status ON field_reports(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_field_reports_author ON field_reports(author);
  `);
}

function migrateConditionsCache(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conditions_cache (
      cache_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conditions_cache_exp ON conditions_cache(expires_at);
  `);
}

function migrateSkiOutingsToOutings(db: Database.Database): void {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ski_outings','outings')`)
    .all() as { name: string }[];
  const names = new Set(tables.map((t) => t.name));
  if (names.has("ski_outings") && !names.has("outings")) {
    db.exec(`ALTER TABLE ski_outings RENAME TO outings`);
    const cols = db.prepare(`PRAGMA table_info(outings)`).all() as { name: string }[];
    if (cols.some((c) => c.name === "snow_notes") && !cols.some((c) => c.name === "notes")) {
      db.exec(`ALTER TABLE outings RENAME COLUMN snow_notes TO notes`);
    }
  } else if (names.has("ski_outings")) {
    // Residuo: il vecchio DDL ricreava `ski_outings` vuota a ogni avvio.
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ski_outings`).get() as { n: number }).n;
    if (n === 0) db.exec(`DROP TABLE ski_outings`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS outings (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL REFERENCES user_routes(id) ON DELETE CASCADE,
      owner TEXT NOT NULL,
      title TEXT NOT NULL,
      outing_date TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ski_outings_route ON outings(route_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ski_outings_owner ON outings(owner, updated_at DESC);

    CREATE TABLE IF NOT EXISTS outing_participants (
      outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      PRIMARY KEY (outing_id, username)
    );
    CREATE INDEX IF NOT EXISTS idx_outing_participants_user ON outing_participants(username);

    CREATE TABLE IF NOT EXISTS outing_groups (
      outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (outing_id, group_id)
    );
    CREATE INDEX IF NOT EXISTS idx_outing_groups_group ON outing_groups(group_id);
  `);
}

/**
 * Gita = uscita su una traccia: piano (soste, note logistiche) + resoconto
 * (condizioni, racconto, foto). Le righe preesistenti erano uscite già fatte:
 * il loro testo libero diventa il racconto.
 */
function migrateOutingsPlanReport(db: Database.Database): void {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(outings)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has("status")) {
    db.exec(
      `ALTER TABLE outings ADD COLUMN status TEXT NOT NULL DEFAULT 'done' CHECK(status IN ('planned','done'))`,
    );
  }
  if (!cols.has("story")) {
    db.exec(`ALTER TABLE outings ADD COLUMN story TEXT NOT NULL DEFAULT ''`);
    db.exec(`UPDATE outings SET story = notes, notes = '' WHERE notes != ''`);
  }
  if (!cols.has("conditions_json")) {
    db.exec(`ALTER TABLE outings ADD COLUMN conditions_json TEXT`);
  }
  if (!cols.has("visibility")) {
    db.exec(
      `ALTER TABLE outings ADD COLUMN visibility TEXT NOT NULL DEFAULT 'participants' CHECK(visibility IN ('participants','public'))`,
    );
  }
  if (!cols.has("start_time")) {
    db.exec(`ALTER TABLE outings ADD COLUMN start_time TEXT`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS outing_stops (
      id TEXT PRIMARY KEY,
      outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'stop' CHECK(role IN ('start','end','stop')),
      kind TEXT NOT NULL DEFAULT 'other',
      name TEXT NOT NULL DEFAULT '',
      lng REAL NOT NULL,
      lat REAL NOT NULL,
      along_km REAL,
      ref TEXT,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_outing_stops_outing ON outing_stops(outing_id, position);
  `);
}

/** OSM camp_site era in lodging; ora categoria dedicata. */
function migratePoisCampsiteCategory(db: Database.Database): void {
  db.prepare(
    `UPDATE pois SET category = 'campsite' WHERE category = 'lodging' AND sub_kind = 'camp_site'`
  ).run();
}

/** Bbox [w, s, e, n] di qualsiasi GeoJSON (coordinate annidate). */
export function geojsonBbox(raw: string): [number, number, number, number] | null {
  let g: unknown;
  try {
    g = JSON.parse(raw);
  } catch {
    return null;
  }
  let w = Infinity;
  let so = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const visit = (v: unknown): void => {
    if (!Array.isArray(v)) {
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if ("coordinates" in o) visit(o.coordinates);
        if ("geometry" in o) visit(o.geometry);
        if ("features" in o) visit(o.features);
        if ("geometries" in o) visit(o.geometries);
        for (const k of ["ascent", "descent"]) if (k in o) visit(o[k]);
      }
      return;
    }
    if (v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number") {
      const x = v[0] as number;
      const y = v[1] as number;
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < so) so = y;
      if (y > n) n = y;
      return;
    }
    for (const it of v) visit(it);
  };
  visit(g);
  return Number.isFinite(w) ? [w, so, e, n] : null;
}

/** Colonne bbox su user_routes (query per area visibile in Esplora) + backfill. */
function migrateUserRoutesBbox(db: Database.Database): void {
  const cols = new Set((db.prepare(`PRAGMA table_info(user_routes)`).all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("bbox_w")) {
    db.exec(`
      ALTER TABLE user_routes ADD COLUMN bbox_w REAL;
      ALTER TABLE user_routes ADD COLUMN bbox_s REAL;
      ALTER TABLE user_routes ADD COLUMN bbox_e REAL;
      ALTER TABLE user_routes ADD COLUMN bbox_n REAL;
    `);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_routes_bbox ON user_routes(visibility, bbox_w, bbox_e, bbox_s, bbox_n)`);
  const todo = db.prepare(`SELECT id, geojson FROM user_routes WHERE bbox_w IS NULL`).all() as { id: string; geojson: string }[];
  if (todo.length === 0) return;
  const upd = db.prepare(`UPDATE user_routes SET bbox_w = ?, bbox_s = ?, bbox_e = ?, bbox_n = ? WHERE id = ?`);
  db.transaction(() => {
    for (const r of todo) {
      const bb = geojsonBbox(r.geojson);
      if (bb) upd.run(bb[0], bb[1], bb[2], bb[3], r.id);
    }
  })();
}

/**
 * Allinea il CHECK su user_routes.activity a USER_ROUTE_ACTIVITIES (nuovi sport).
 * Ricostruisce la tabella con foreign key disattivate: un DROP con FK attive
 * cancellerebbe a cascata gite e collegamenti.
 */
function migrateUserRoutesActivityCheck(db: Database.Database): void {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_routes'`)
    .get() as { sql?: string } | undefined;
  if (!row?.sql) return;
  const missing = USER_ROUTE_ACTIVITIES.filter((a) => !row.sql!.includes(`'${a}'`));
  if (missing.length === 0) return;

  const cols = (db.prepare(`PRAGMA table_info(user_routes)`).all() as { name: string }[]).map((c) => c.name);
  const newSql = row.sql
    .replace(/CHECK\s*\(\s*activity\s+IN\s*\([^)]*\)\s*\)/i, `CHECK(activity IN (${USER_ROUTE_ACTIVITY_CHECK_IN}))`)
    .replace(/CREATE TABLE\s+("?user_routes"?)/i, "CREATE TABLE user_routes_activity_mig");
  if (!newSql.includes("user_routes_activity_mig")) return;
  const colList = cols.map((c) => `"${c}"`).join(", ");

  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    db.exec(newSql);
    db.exec(`INSERT INTO user_routes_activity_mig (${colList}) SELECT ${colList} FROM user_routes`);
    db.exec(`DROP TABLE user_routes`);
    db.exec(`ALTER TABLE user_routes_activity_mig RENAME TO user_routes`);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_routes_owner ON user_routes(owner, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_routes_visibility ON user_routes(visibility, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_routes_source_ext ON user_routes(source, external_id);
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/** Estende CHECK activity su user_routes per i 9 sport. */
function migrateUserRoutesNineActivities(db: Database.Database): void {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_routes'`)
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'trail_run'")) return;

  const cols = db.prepare(`PRAGMA table_info(user_routes)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  const hasSource = names.has("source");

  db.exec(`
    CREATE TABLE user_routes_nine_mig (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      activity TEXT NOT NULL CHECK(activity IN (${USER_ROUTE_ACTIVITY_CHECK_IN})),
      geojson TEXT NOT NULL,
      waypoints_json TEXT NOT NULL DEFAULT '[]',
      length_km REAL NOT NULL DEFAULT 0,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      elev_loss_m REAL NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
      source TEXT,
      source_url TEXT,
      license TEXT,
      external_id TEXT,
      meta_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  if (hasSource) {
    db.exec(`
      INSERT INTO user_routes_nine_mig (
        id, owner, name, activity, geojson, waypoints_json, length_km, elev_gain_m,
        elev_loss_m, visibility, source, source_url, license, external_id, meta_json,
        created_at, updated_at
      )
      SELECT
        id, owner, name, activity, geojson, waypoints_json, length_km, elev_gain_m,
        elev_loss_m, visibility, source, source_url, license, external_id, meta_json,
        created_at, updated_at
      FROM user_routes;
    `);
  } else {
    db.exec(`
      INSERT INTO user_routes_nine_mig (
        id, owner, name, activity, geojson, waypoints_json, length_km, elev_gain_m,
        elev_loss_m, visibility, created_at, updated_at
      )
      SELECT
        id, owner, name, activity, geojson, waypoints_json, length_km, elev_gain_m,
        elev_loss_m, visibility, created_at, updated_at
      FROM user_routes;
    `);
  }

  db.exec(`
    DROP TABLE user_routes;
    ALTER TABLE user_routes_nine_mig RENAME TO user_routes;
    CREATE INDEX IF NOT EXISTS idx_user_routes_owner ON user_routes(owner, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_routes_visibility ON user_routes(visibility, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_routes_source_ext ON user_routes(source, external_id);
  `);
}

/** Estende CHECK activity su user_routes per includere ski. */
function migrateUserRoutesSkiActivity(db: Database.Database): void {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_routes'`)
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'ski'")) return;

  db.exec(`
    CREATE TABLE user_routes_ski_mig (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      activity TEXT NOT NULL CHECK(activity IN ('road','mtb','hike','gravel','ski','trail_run','snowshoe','nordic','ferrata')),
      geojson TEXT NOT NULL,
      waypoints_json TEXT NOT NULL DEFAULT '[]',
      length_km REAL NOT NULL DEFAULT 0,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      elev_loss_m REAL NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO user_routes_ski_mig SELECT * FROM user_routes;
    DROP TABLE user_routes;
    ALTER TABLE user_routes_ski_mig RENAME TO user_routes;
    CREATE INDEX IF NOT EXISTS idx_user_routes_owner ON user_routes(owner, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_routes_visibility ON user_routes(visibility, updated_at DESC);
  `);
}

/** Aggiunge colonne sorgente e metadati estesi su user_routes. */
function migrateUserRoutesSourceMeta(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(user_routes)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("source")) db.exec(`ALTER TABLE user_routes ADD COLUMN source TEXT`);
  if (!names.has("source_url")) db.exec(`ALTER TABLE user_routes ADD COLUMN source_url TEXT`);
  if (!names.has("license")) db.exec(`ALTER TABLE user_routes ADD COLUMN license TEXT`);
  if (!names.has("external_id")) db.exec(`ALTER TABLE user_routes ADD COLUMN external_id TEXT`);
  if (!names.has("meta_json")) db.exec(`ALTER TABLE user_routes ADD COLUMN meta_json TEXT`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_user_routes_source_ext ON user_routes(source, external_id)`,
  );
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
      activity TEXT NOT NULL CHECK(activity IN ('road','mtb','hike','gravel','ski','trail_run','snowshoe','nordic','ferrata')),
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

export type { UserRouteActivity } from "@/lib/sports";

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
  source: string | null;
  source_url: string | null;
  license: string | null;
  external_id: string | null;
  meta_json: string | null;
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

export type AmaroMemberRow = {
  member_id: number;
  username: string;
  email: string;
  created_at: number;
  last_login_at: number;
};

export function getAmaroMemberById(memberId: number): AmaroMemberRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM amaro_members WHERE member_id = ?`)
    .get(memberId) as AmaroMemberRow | undefined;
}

export function isAmaroMemberUsername(username: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM amaro_members WHERE username = ?`)
    .get(username.trim().toLowerCase());
  return row !== undefined;
}

export function insertAmaroMember(input: {
  member_id: number;
  username: string;
  email: string;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO amaro_members (member_id, username, email, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.member_id, input.username.trim().toLowerCase(), input.email, input.now, input.now);
}

export function touchAmaroMember(memberId: number, email: string, now: number): void {
  getDb()
    .prepare(`UPDATE amaro_members SET email = ?, last_login_at = ? WHERE member_id = ?`)
    .run(email, now, memberId);
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

export function getUserRouteByExternal(source: string, externalId: string): UserRouteRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM user_routes WHERE source = ? AND external_id = ?`)
    .get(source, externalId) as UserRouteRow | undefined;
}

function bboxParams(geojson: string): { bbox_w: number | null; bbox_s: number | null; bbox_e: number | null; bbox_n: number | null } {
  const bb = geojsonBbox(geojson);
  return bb
    ? { bbox_w: bb[0], bbox_s: bb[1], bbox_e: bb[2], bbox_n: bb[3] }
    : { bbox_w: null, bbox_s: null, bbox_e: null, bbox_n: null };
}

/**
 * Percorsi pubblici che intersecano l'area visibile. Prima i percorsi creati dagli utenti,
 * poi quelli importati; esclude i tracciati molto più grandi dell'area (es. lunghe ciclovie
 * a zoom alto restano, ma non saturano il limite).
 */
export function listPublicRoutesInBbox(
  activity: UserRouteActivity | null,
  bbox: { south: number; west: number; north: number; east: number },
  limit = 400,
): { rows: UserRouteRow[]; total: number } {
  // Affinità tra sport (es. corsa → anche escursionismo): vedi src/lib/sport-affinity.ts.
  const aff = activity ? activityFilterSql(activity) : null;
  const where = `visibility = 'public' AND bbox_e >= @west AND bbox_w <= @east AND bbox_n >= @south AND bbox_s <= @north${
    aff ? ` AND ${aff.sql}` : ""
  }`;
  const params = { ...bbox, activity, limit, ...(aff?.params ?? {}) };
  const db = getDb();
  const total = (db.prepare(`SELECT count(*) AS n FROM user_routes WHERE ${where}`).get(params) as { n: number }).n;
  // Ordine: percorsi utente, sport esatto prima degli affini, poi declassa spezzoni corti e
  // relazioni OSM parziali (coverage < 0.9) o con punteggio di qualità basso, infine scala dell'area.
  const rows = db
    .prepare(
      `SELECT * FROM user_routes WHERE ${where}
       ORDER BY (source IS NULL) DESC,
                ${activity ? "(activity = @activity) DESC," : ""}
                CASE
                  WHEN source = 'osm' AND (length_km < 2 OR coalesce(json_extract(meta_json, '$.coverage'), 1) < 0.9) THEN 1
                  WHEN coalesce(json_extract(meta_json, '$.quality'), 1) < 0.5 THEN 1
                  ELSE 0
                END ASC,
                abs(((bbox_e - bbox_w) * (bbox_n - bbox_s)) - ((@east - @west) * (@north - @south)) * 0.05) ASC
       LIMIT @limit`,
    )
    .all(params) as UserRouteRow[];
  return { rows, total };
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
  source?: string | null;
  source_url?: string | null;
  license?: string | null;
  external_id?: string | null;
  meta_json?: string | null;
  created_at: number;
  updated_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO user_routes (
        id, owner, name, activity, geojson, waypoints_json,
        length_km, elev_gain_m, elev_loss_m, visibility,
        source, source_url, license, external_id, meta_json,
        created_at, updated_at, bbox_w, bbox_s, bbox_e, bbox_n
      ) VALUES (
        @id, @owner, @name, @activity, @geojson, @waypoints_json,
        @length_km, @elev_gain_m, @elev_loss_m, @visibility,
        @source, @source_url, @license, @external_id, @meta_json,
        @created_at, @updated_at, @bbox_w, @bbox_s, @bbox_e, @bbox_n
      )`
    )
    .run({
      ...input,
      ...bboxParams(input.geojson),
      owner: input.owner.trim().toLowerCase(),
      source: input.source ?? null,
      source_url: input.source_url ?? null,
      license: input.license ?? null,
      external_id: input.external_id ?? null,
      meta_json: input.meta_json ?? null,
    });
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
    source?: string | null;
    source_url?: string | null;
    license?: string | null;
    external_id?: string | null;
    meta_json?: string | null;
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
        source = @source,
        source_url = @source_url,
        license = @license,
        external_id = @external_id,
        meta_json = @meta_json,
        updated_at = @updated_at,
        bbox_w = @bbox_w,
        bbox_s = @bbox_s,
        bbox_e = @bbox_e,
        bbox_n = @bbox_n
      WHERE id = @id`
    )
    .run({
      id,
      ...bboxParams(patch.geojson ?? row.geojson),
      name: patch.name ?? row.name,
      activity: patch.activity ?? row.activity,
      geojson: patch.geojson ?? row.geojson,
      waypoints_json: patch.waypoints_json ?? row.waypoints_json,
      length_km: patch.length_km ?? row.length_km,
      elev_gain_m: patch.elev_gain_m ?? row.elev_gain_m,
      elev_loss_m: patch.elev_loss_m ?? row.elev_loss_m,
      visibility: patch.visibility ?? row.visibility,
      source: patch.source !== undefined ? patch.source : row.source,
      source_url: patch.source_url !== undefined ? patch.source_url : row.source_url,
      license: patch.license !== undefined ? patch.license : row.license,
      external_id: patch.external_id !== undefined ? patch.external_id : row.external_id,
      meta_json: patch.meta_json !== undefined ? patch.meta_json : row.meta_json,
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
  trust_score: number;
  trust_tier: TrustTier;
  created_at: number;
  updated_at: number;
};

export type TrustTier = "new" | "reliable" | "expert";

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
      `INSERT INTO user_profiles (username, display_name, bio, avatar_path, home_area, level, trust_score, trust_tier, created_at, updated_at)
       VALUES (?, '', '', NULL, '', 'intermediate', 0, 'new', ?, ?)`
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

// --- Outings (gita vs percorso) ---

export type OutingStatus = "planned" | "done";
export type OutingVisibility = "participants" | "public";

export type OutingRow = {
  id: string;
  route_id: string;
  owner: string;
  title: string;
  outing_date: string | null;
  /** Note logistiche del piano. */
  notes: string;
  status: OutingStatus;
  /** Racconto della gita fatta. */
  story: string;
  conditions_json: string | null;
  visibility: OutingVisibility;
  start_time: string | null;
  created_at: number;
  updated_at: number;
};

export function insertOuting(input: {
  id: string;
  route_id: string;
  owner: string;
  title: string;
  outing_date?: string | null;
  notes?: string;
  status?: OutingStatus;
  story?: string;
  conditions_json?: string | null;
  visibility?: OutingVisibility;
  start_time?: string | null;
  created_at: number;
  updated_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO outings (id, route_id, owner, title, outing_date, notes, status, story,
         conditions_json, visibility, start_time, created_at, updated_at)
       VALUES (@id, @route_id, @owner, @title, @outing_date, @notes, @status, @story,
         @conditions_json, @visibility, @start_time, @created_at, @updated_at)`,
    )
    .run({
      id: input.id,
      route_id: input.route_id,
      title: input.title,
      created_at: input.created_at,
      updated_at: input.updated_at,
      owner: input.owner.trim().toLowerCase(),
      outing_date: input.outing_date ?? null,
      notes: input.notes ?? "",
      status: input.status ?? "planned",
      story: input.story ?? "",
      conditions_json: input.conditions_json ?? null,
      visibility: input.visibility ?? "participants",
      start_time: input.start_time ?? null,
    });
}

export type OutingPatch = Partial<
  Pick<
    OutingRow,
    "title" | "outing_date" | "notes" | "status" | "story" | "conditions_json" | "visibility" | "start_time"
  >
>;

const OUTING_PATCH_COLS = [
  "title",
  "outing_date",
  "notes",
  "status",
  "story",
  "conditions_json",
  "visibility",
  "start_time",
] as const;

export function updateOuting(id: string, patch: OutingPatch): boolean {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, updated_at: Date.now() };
  for (const col of OUTING_PATCH_COLS) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = @${col}`);
    params[col] = patch[col];
  }
  if (sets.length === 0) return false;
  const r = getDb()
    .prepare(`UPDATE outings SET ${sets.join(", ")}, updated_at = @updated_at WHERE id = @id`)
    .run(params);
  return r.changes > 0;
}

export function deleteOuting(id: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    db.prepare(`UPDATE user_photos SET outing_id = NULL WHERE outing_id = ?`).run(id);
    return db.prepare(`DELETE FROM outings WHERE id = ?`).run(id).changes > 0;
  })();
}

export type OutingStopRole = "start" | "end" | "stop";

export type OutingStopRow = {
  id: string;
  outing_id: string;
  position: number;
  role: OutingStopRole;
  kind: string;
  name: string;
  lng: number;
  lat: number;
  along_km: number | null;
  ref: string | null;
  note: string;
};

export function listOutingStops(outingId: string): OutingStopRow[] {
  return getDb()
    .prepare(`SELECT * FROM outing_stops WHERE outing_id = ? ORDER BY position`)
    .all(outingId) as OutingStopRow[];
}

/** Sostituisce tutte le soste della gita (ordine = posizione nell'array). */
export function replaceOutingStops(
  outingId: string,
  stops: Omit<OutingStopRow, "id" | "outing_id" | "position">[],
): void {
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO outing_stops (id, outing_id, position, role, kind, name, lng, lat, along_km, ref, note)
     VALUES (@id, @outing_id, @position, @role, @kind, @name, @lng, @lat, @along_km, @ref, @note)`,
  );
  db.transaction(() => {
    db.prepare(`DELETE FROM outing_stops WHERE outing_id = ?`).run(outingId);
    stops.forEach((s, i) => {
      ins.run({
        id: crypto.randomUUID(),
        outing_id: outingId,
        position: i,
        role: s.role,
        kind: s.kind,
        name: s.name,
        lng: s.lng,
        lat: s.lat,
        along_km: s.along_km ?? null,
        ref: s.ref ?? null,
        note: s.note ?? "",
      });
    });
  })();
}

export function setOutingParticipants(outingId: string, usernames: string[]): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM outing_participants WHERE outing_id = ?`).run(outingId);
    for (const u of new Set(usernames.map(normalizeUser))) addOutingParticipant(outingId, u);
  })();
}

export function setOutingGroups(outingId: string, groupIds: string[]): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM outing_groups WHERE outing_id = ?`).run(outingId);
    for (const g of new Set(groupIds)) addOutingGroup(outingId, g);
  })();
}

export function addOutingParticipant(outingId: string, username: string): void {
  getDb()
    .prepare(`INSERT OR IGNORE INTO outing_participants (outing_id, username) VALUES (?, ?)`)
    .run(outingId, normalizeUser(username));
}

export function addOutingGroup(outingId: string, groupId: string): void {
  getDb()
    .prepare(`INSERT OR IGNORE INTO outing_groups (outing_id, group_id) VALUES (?, ?)`)
    .run(outingId, groupId);
}

export function getOuting(id: string): OutingRow | undefined {
  return getDb().prepare(`SELECT * FROM outings WHERE id = ?`).get(id) as OutingRow | undefined;
}

export function listPublicSkiRoutes(): UserRouteRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM user_routes
       WHERE activity = 'ski' AND visibility = 'public'
       ORDER BY updated_at DESC`,
    )
    .all() as UserRouteRow[];
}

export function listSkiRoutesForMyOutings(username: string): UserRouteRow[] {
  const u = normalizeUser(username);
  return getDb()
    .prepare(
      `SELECT DISTINCT r.* FROM user_routes r
       INNER JOIN outings o ON o.route_id = r.id
       LEFT JOIN outing_participants p ON p.outing_id = o.id
       WHERE o.owner = ? OR p.username = ?
       ORDER BY r.updated_at DESC`,
    )
    .all(u, u) as UserRouteRow[];
}

export function listSkiRoutesForGroup(groupId: string): UserRouteRow[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT r.* FROM user_routes r
       INNER JOIN outings o ON o.route_id = r.id
       INNER JOIN outing_groups og ON og.outing_id = o.id
       WHERE og.group_id = ?
       ORDER BY r.updated_at DESC`,
    )
    .all(groupId) as UserRouteRow[];
}

export function listOutingParticipants(outingId: string): string[] {
  return (
    getDb()
      .prepare(`SELECT username FROM outing_participants WHERE outing_id = ? ORDER BY username`)
      .all(outingId) as { username: string }[]
  ).map((r) => r.username);
}

export function listOutingGroups(outingId: string): string[] {
  return (
    getDb()
      .prepare(`SELECT group_id FROM outing_groups WHERE outing_id = ? ORDER BY group_id`)
      .all(outingId) as { group_id: string }[]
  ).map((r) => r.group_id);
}

const OUTING_VISIBLE_SQL = `
  o.visibility = 'public'
  OR o.owner = @user
  OR EXISTS (
    SELECT 1 FROM outing_participants p
    WHERE p.outing_id = o.id AND p.username = @user
  )
  OR EXISTS (
    SELECT 1 FROM outing_groups og
    INNER JOIN group_members gm ON gm.group_id = og.group_id AND gm.username = @user
    WHERE og.outing_id = o.id
  )
  OR EXISTS (
    SELECT 1 FROM user_routes r
    WHERE r.id = o.route_id AND r.owner = @user
  )
`;

export function canViewOuting(outingId: string, username: string): boolean {
  const user = normalizeUser(username);
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM outings o
       WHERE o.id = @outingId AND (${OUTING_VISIBLE_SQL})`,
    )
    .get({ outingId, user }) as { ok: number } | undefined;
  return row?.ok === 1;
}

export function listOutingsForRoute(routeId: string): OutingRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM outings
       WHERE route_id = ?
       ORDER BY outing_date DESC, updated_at DESC`,
    )
    .all(routeId) as OutingRow[];
}

export function listOutingsVisibleForRoute(routeId: string, username: string): OutingRow[] {
  const user = normalizeUser(username);
  return getDb()
    .prepare(
      `SELECT o.* FROM outings o
       WHERE o.route_id = @routeId AND (${OUTING_VISIBLE_SQL})
       ORDER BY o.outing_date DESC, o.updated_at DESC`,
    )
    .all({ routeId, user }) as OutingRow[];
}

export function listOutingsVisibleForUser(username: string): OutingRow[] {
  const user = normalizeUser(username);
  return getDb()
    .prepare(
      `SELECT o.* FROM outings o
       WHERE ${OUTING_VISIBLE_SQL}
       ORDER BY o.outing_date DESC, o.updated_at DESC`,
    )
    .all({ user }) as OutingRow[];
}

export function countOutingsVisibleForRoute(routeId: string, username: string): number {
  const user = normalizeUser(username);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM outings o
       WHERE o.route_id = @routeId AND (${OUTING_VISIBLE_SQL})`,
    )
    .get({ routeId, user }) as { n: number };
  return row.n;
}

/* ---------------- User photos ---------------- */

export type UserPhotoRow = {
  id: string;
  owner: string;
  lng: number;
  lat: number;
  caption: string;
  photo_path: string;
  route_id: string | null;
  outing_id: string | null;
  created_at: number;
};

export function insertUserPhoto(input: {
  id: string;
  owner: string;
  lng: number;
  lat: number;
  caption?: string;
  photo_path: string;
  route_id?: string | null;
  outing_id?: string | null;
  created_at: number;
}): UserPhotoRow {
  getDb()
    .prepare(
      `INSERT INTO user_photos (id, owner, lng, lat, caption, photo_path, route_id, outing_id, created_at)
       VALUES (@id, @owner, @lng, @lat, @caption, @photo_path, @route_id, @outing_id, @created_at)`,
    )
    .run({
      ...input,
      owner: normalizeUser(input.owner),
      caption: input.caption ?? "",
      route_id: input.route_id ?? null,
      outing_id: input.outing_id ?? null,
    });
  return getUserPhoto(input.id)!;
}

export function getUserPhoto(id: string): UserPhotoRow | undefined {
  return getDb().prepare(`SELECT * FROM user_photos WHERE id = ?`).get(id) as UserPhotoRow | undefined;
}

export function countUserPhotos(owner: string): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM user_photos WHERE owner = ?`)
    .get(normalizeUser(owner)) as { n: number };
  return r.n;
}

export function listUserPhotos(owner: string, limit = 50): UserPhotoRow[] {
  return getDb()
    .prepare(`SELECT * FROM user_photos WHERE owner = ? ORDER BY created_at DESC LIMIT ?`)
    .all(normalizeUser(owner), limit) as UserPhotoRow[];
}

export function listUserPhotosForOuting(outingId: string): UserPhotoRow[] {
  return getDb()
    .prepare(`SELECT * FROM user_photos WHERE outing_id = ? ORDER BY created_at ASC`)
    .all(outingId) as UserPhotoRow[];
}

export function listUserPhotosInBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  limit = 200,
): UserPhotoRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM user_photos
       WHERE lat BETWEEN @south AND @north AND lng BETWEEN @west AND @east
       ORDER BY created_at DESC LIMIT @limit`,
    )
    .all({ south, west, north, east, limit }) as UserPhotoRow[];
}

/* ---------------- Field reports ---------------- */

export type { FieldReportKind } from "./field-reports";

export type FieldReportStatus = "active" | "resolved";

export type FieldReportRow = {
  id: string;
  author: string;
  lng: number;
  lat: number;
  kind: FieldReportKind;
  description: string;
  route_id: string | null;
  status: FieldReportStatus;
  confirmation_count: number;
  severity: number;
  expires_at: number | null;
  photo_id: string | null;
  created_at: number;
  updated_at: number;
};

export function insertFieldReport(input: {
  id: string;
  author: string;
  lng: number;
  lat: number;
  kind: FieldReportKind;
  description?: string;
  route_id?: string | null;
  photo_id?: string | null;
  severity?: number;
  created_at: number;
  updated_at: number;
}): FieldReportRow {
  const severity = input.severity ?? REPORT_KIND_SEVERITY[input.kind];
  const expires_at = expiresAtForKind(input.kind, input.created_at);
  getDb()
    .prepare(
      `INSERT INTO field_reports (
        id, author, lng, lat, kind, description, route_id, status, confirmation_count,
        severity, expires_at, photo_id, created_at, updated_at
      )
       VALUES (
        @id, @author, @lng, @lat, @kind, @description, @route_id, 'active', 0,
        @severity, @expires_at, @photo_id, @created_at, @updated_at
      )`,
    )
    .run({
      ...input,
      author: normalizeUser(input.author),
      description: input.description ?? "",
      route_id: input.route_id ?? null,
      photo_id: input.photo_id ?? null,
      severity,
      expires_at,
    });
  return getFieldReport(input.id)!;
}

export function getFieldReport(id: string): FieldReportRow | undefined {
  return getDb().prepare(`SELECT * FROM field_reports WHERE id = ?`).get(id) as FieldReportRow | undefined;
}

export function listFieldReportsInBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  activeOnly = true,
): FieldReportRow[] {
  const now = Date.now();
  const statusClause = activeOnly
    ? `AND status = 'active' AND (expires_at IS NULL OR expires_at > @now)`
    : "";
  return getDb()
    .prepare(
      `SELECT * FROM field_reports
       WHERE lat BETWEEN @south AND @north AND lng BETWEEN @west AND @east ${statusClause}
       ORDER BY updated_at DESC`,
    )
    .all({ south, west, north, east, now }) as FieldReportRow[];
}

export function listFieldReportsByAuthor(author: string): FieldReportRow[] {
  return getDb()
    .prepare(`SELECT * FROM field_reports WHERE author = ? ORDER BY created_at DESC`)
    .all(normalizeUser(author)) as FieldReportRow[];
}

export function hasActiveReportNearby(
  author: string,
  lng: number,
  lat: number,
  radiusDeg = 0.002,
): boolean {
  const u = normalizeUser(author);
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM field_reports
       WHERE author = @u AND status = 'active'
         AND lng BETWEEN @lng - @r AND @lng + @r
         AND lat BETWEEN @lat - @r AND @lat + @r
       LIMIT 1`,
    )
    .get({ u, lng, lat, r: radiusDeg }) as { ok: number } | undefined;
  return !!row;
}

export function addFieldReportConfirmation(reportId: string, username: string): boolean {
  const now = Date.now();
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO field_report_confirmations (report_id, username, created_at) VALUES (?, ?, ?)`,
    )
    .run(reportId, normalizeUser(username), now);
  if (res.changes > 0) {
    const before = getFieldReport(reportId);
    const renewed = before ? renewExpiresAt(before.kind, now) : null;
    getDb()
      .prepare(
        `UPDATE field_reports SET confirmation_count = confirmation_count + 1, updated_at = ?, expires_at = COALESCE(?, expires_at) WHERE id = ?`,
      )
      .run(now, renewed, reportId);
    const after = getFieldReport(reportId);
    if (after && after.confirmation_count >= 2) {
      recalcTrustScore(after.author);
    }
    return true;
  }
  return false;
}

export function resolveFieldReport(reportId: string): void {
  const now = Date.now();
  getDb()
    .prepare(`UPDATE field_reports SET status = 'resolved', updated_at = ? WHERE id = ?`)
    .run(now, reportId);
}

export function countFieldReportResolveVotes(reportId: string): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM field_report_resolve_votes WHERE report_id = ?`)
    .get(reportId) as { n: number };
  return r.n;
}

/** Aggiunge voto "non c'è più"; risolve se raggiunge 2 voti. */
export function addFieldReportResolveVote(reportId: string, username: string): {
  resolved: boolean;
  votes: number;
} {
  const now = Date.now();
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO field_report_resolve_votes (report_id, username, created_at) VALUES (?, ?, ?)`,
    )
    .run(reportId, normalizeUser(username), now);
  const votes = countFieldReportResolveVotes(reportId);
  if (res.changes > 0 && votes >= 2) {
    resolveFieldReport(reportId);
    return { resolved: true, votes };
  }
  return { resolved: false, votes };
}

export function getConditionsCache(key: string): string | null {
  const now = Date.now();
  const row = getDb()
    .prepare(`SELECT payload_json FROM conditions_cache WHERE cache_key = ? AND expires_at > ?`)
    .get(key, now) as { payload_json: string } | undefined;
  return row?.payload_json ?? null;
}

export function setConditionsCache(key: string, payloadJson: string, ttlMs: number): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO conditions_cache (cache_key, payload_json, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, expires_at = excluded.expires_at`,
    )
    .run(key, payloadJson, now + ttlMs);
}

export function hasConfirmedReport(reportId: string, username: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM field_report_confirmations WHERE report_id = ? AND username = ?`,
    )
    .get(reportId, normalizeUser(username)) as { ok: number } | undefined;
  return !!row;
}

export function countVerifiedReportsByAuthor(author: string): number {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM field_reports WHERE author = ? AND status = 'active' AND confirmation_count >= 2`,
    )
    .get(normalizeUser(author)) as { n: number };
  return r.n;
}

export function countConfirmationsReceived(author: string): number {
  const r = getDb()
    .prepare(
      `SELECT COALESCE(SUM(confirmation_count), 0) AS n FROM field_reports WHERE author = ?`,
    )
    .get(normalizeUser(author)) as { n: number };
  return r.n;
}

export function trustTierFromScore(score: number): TrustTier {
  if (score >= 10) return "expert";
  if (score >= 3) return "reliable";
  return "new";
}

export function recalcTrustScore(username: string): void {
  const u = normalizeUser(username);
  const verified = countVerifiedReportsByAuthor(u);
  const confirmations = countConfirmationsReceived(u);
  const score = verified * 2 + confirmations;
  const tier = trustTierFromScore(score);
  getDb()
    .prepare(`UPDATE user_profiles SET trust_score = ?, trust_tier = ?, updated_at = ? WHERE username = ?`)
    .run(score, tier, Date.now(), u);
}

/* ---------------- Group invites ---------------- */

export type GroupInviteStatus = "pending" | "accepted" | "declined";

export type GroupInviteRow = {
  group_id: string;
  username: string;
  invited_by: string;
  status: GroupInviteStatus;
  created_at: number;
  updated_at: number;
};

export function insertGroupInvite(input: {
  group_id: string;
  username: string;
  invited_by: string;
  created_at: number;
  updated_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO group_invites (group_id, username, invited_by, status, created_at, updated_at)
       VALUES (@group_id, @username, @invited_by, 'pending', @created_at, @updated_at)`,
    )
    .run({
      ...input,
      username: normalizeUser(input.username),
      invited_by: normalizeUser(input.invited_by),
    });
}

export function listPendingInvitesForUser(username: string): GroupInviteRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM group_invites WHERE username = ? AND status = 'pending' ORDER BY created_at DESC`,
    )
    .all(normalizeUser(username)) as GroupInviteRow[];
}

export function updateGroupInviteStatus(
  groupId: string,
  username: string,
  status: GroupInviteStatus,
): void {
  getDb()
    .prepare(
      `UPDATE group_invites SET status = ?, updated_at = ? WHERE group_id = ? AND username = ?`,
    )
    .run(status, Date.now(), groupId, normalizeUser(username));
}

export function listOutingsForGroup(groupId: string): OutingRow[] {
  return getDb()
    .prepare(
      `SELECT o.* FROM outings o
       INNER JOIN outing_groups og ON og.outing_id = o.id
       WHERE og.group_id = ?
       ORDER BY o.outing_date DESC, o.updated_at DESC`,
    )
    .all(groupId) as OutingRow[];
}

export function listRoutesForExplore(
  activity: UserRouteActivity | null,
  scope: "public" | "mine" | "group",
  username: string,
  groupId?: string,
): UserRouteRow[] {
  const u = normalizeUser(username);
  if (scope === "public") {
    if (activity) {
      const aff = activityFilterSql(activity);
      return getDb()
        .prepare(
          `SELECT * FROM user_routes WHERE visibility = 'public' AND ${aff.sql}
           ORDER BY (activity = @activity) DESC, updated_at DESC`,
        )
        .all({ ...aff.params, activity }) as UserRouteRow[];
    }
    return getDb()
      .prepare(`SELECT * FROM user_routes WHERE visibility = 'public' ORDER BY updated_at DESC`)
      .all() as UserRouteRow[];
  }
  if (scope === "mine") {
    if (activity) {
      return getDb()
        .prepare(
          `SELECT DISTINCT r.* FROM user_routes r
           INNER JOIN outings o ON o.route_id = r.id
           LEFT JOIN outing_participants p ON p.outing_id = o.id
           WHERE (o.owner = ? OR p.username = ?) AND r.activity = ?
           ORDER BY r.updated_at DESC`,
        )
        .all(u, u, activity) as UserRouteRow[];
    }
    return getDb()
      .prepare(
        `SELECT DISTINCT r.* FROM user_routes r
         INNER JOIN outings o ON o.route_id = r.id
         LEFT JOIN outing_participants p ON p.outing_id = o.id
         WHERE o.owner = ? OR p.username = ?
         ORDER BY r.updated_at DESC`,
      )
      .all(u, u) as UserRouteRow[];
  }
  if (scope === "group" && groupId) {
    if (activity) {
      return getDb()
        .prepare(
          `SELECT DISTINCT r.* FROM user_routes r
           INNER JOIN outings o ON o.route_id = r.id
           INNER JOIN outing_groups og ON og.outing_id = o.id
           WHERE og.group_id = ? AND r.activity = ?
           ORDER BY r.updated_at DESC`,
        )
        .all(groupId, activity) as UserRouteRow[];
    }
    return getDb()
      .prepare(
        `SELECT DISTINCT r.* FROM user_routes r
         INNER JOIN outings o ON o.route_id = r.id
         INNER JOIN outing_groups og ON og.outing_id = o.id
         WHERE og.group_id = ?
         ORDER BY r.updated_at DESC`,
      )
      .all(groupId) as UserRouteRow[];
  }
  return [];
}

export type UserStats = {
  total_routes: number;
  public_routes: number;
  total_km: number;
  total_elev_gain_m: number;
  outings_count: number;
  photos_count: number;
  reports_sent: number;
  reports_verified: number;
  confirmations_received: number;
  by_activity: Record<UserRouteActivity, number>;
};

export function getUserStats(username: string): UserStats {
  const u = normalizeUser(username);
  const routeAgg = getDb()
    .prepare(
      `SELECT COUNT(*) AS total_routes,
              COALESCE(SUM(length_km), 0) AS total_km,
              COALESCE(SUM(elev_gain_m), 0) AS total_elev_gain_m
       FROM user_routes WHERE owner = ?`,
    )
    .get(u) as { total_routes: number; total_km: number; total_elev_gain_m: number };

  const byActivity = getDb()
    .prepare(`SELECT activity, COUNT(*) AS n FROM user_routes WHERE owner = ? GROUP BY activity`)
    .all(u) as Array<{ activity: UserRouteActivity; n: number }>;

  const by_activity = emptyActivityCounts();
  for (const row of byActivity) {
    by_activity[row.activity] = row.n;
  }

  const outingsRow = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM outings WHERE owner = ?`)
    .get(u) as { n: number };

  const reportsRow = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM field_reports WHERE author = ?`)
    .get(u) as { n: number };

  return {
    total_routes: routeAgg.total_routes,
    public_routes: countPublicRoutesForOwner(u),
    total_km: routeAgg.total_km,
    total_elev_gain_m: routeAgg.total_elev_gain_m,
    outings_count: outingsRow.n,
    photos_count: countUserPhotos(u),
    reports_sent: reportsRow.n,
    reports_verified: countVerifiedReportsByAuthor(u),
    confirmations_received: countConfirmationsReceived(u),
    by_activity,
  };
}

