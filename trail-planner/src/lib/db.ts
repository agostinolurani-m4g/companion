import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Position } from "geojson";
import { v4 as uuidv4 } from "uuid";
import {
  DEMO_GROUP_CAI,
  DEMO_USER_ANA,
  DEMO_USER_GIULIA,
  DEMO_USER_GUIDE_LUCA,
  DEMO_USER_MARTINO,
  DEMO_USER_SELF,
} from "@/lib/social-constants";
import type {
  ActivityType,
  CanonicalRouteRow,
  ExplorePlaceRow,
  GroupRow,
  ItineraryRow,
  MapPoiRow,
  OutingForUserListRow,
  OutingRow,
  ProfileRow,
  RouteVariantRow,
  SegmentType,
  StopRow,
  TrackRow,
  UserRow,
  WaypointRole,
} from "@/lib/types";
import { sortStopsByOrder } from "@/lib/leg-stops";
import { defaultWaypointRoleForSegmentType } from "@/lib/waypoint-role";

const DATA_DIR = path.join(process.cwd(), "data");

function resolveTrailPlannerDbPath(): string {
  const override = process.env.TRAIL_PLANNER_DB_PATH?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }
  return path.join(DATA_DIR, "trail-planner.db");
}

let dbInstance: Database.Database | null = null;
let dbOpenedPath: string | null = null;

/**
 * Chiude la connessione SQLite (es. test che usano un file diverso).
 * Il prossimo `getDb()` riapre secondo `TRAIL_PLANNER_DB_PATH` o il default.
 */
export function resetTrailPlannerDbConnection(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbOpenedPath = null;
  }
}

export function getDb(): Database.Database {
  const targetPath = resolveTrailPlannerDbPath();
  if (dbInstance && dbOpenedPath === targetPath) return dbInstance;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbOpenedPath = null;
  }
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(targetPath);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  ensureStopImageUrlColumn(db);
  ensureStopWebsiteUrlColumn(db);
  ensureStopPhoneColumn(db);
  ensureStopWaypointRoleColumn(db);
  ensureStopLegIndexColumn(db);
  ensureOsmOverpassCacheTable(db);
  ensureRouteVariantsTable(db);
  ensureItineraryActiveRouteVariantColumn(db);
  ensureMapPoiContactColumns(db);
  ensureSocialTables(db);
  seedSocialDemoIfEmpty(db);
  seedExploreIfEmpty(db);
  ensureDefaultProfile(db);
  ensureProfileActiveUserColumn(db);
  ensureItineraryPlannerColumns(db);
  dbInstance = db;
  dbOpenedPath = targetPath;
  return db;
}

function ensureItineraryPlannerColumns(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(itineraries)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "safety_checklist_json")) {
    db.exec("ALTER TABLE itineraries ADD COLUMN safety_checklist_json TEXT");
  }
  if (!cols.some((c) => c.name === "planner_notes")) {
    db.exec("ALTER TABLE itineraries ADD COLUMN planner_notes TEXT");
  }
}

function ensureStopImageUrlColumn(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(stops)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "image_url")) {
    db.exec("ALTER TABLE stops ADD COLUMN image_url TEXT");
  }
}

function ensureStopWebsiteUrlColumn(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(stops)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "website_url")) {
    db.exec("ALTER TABLE stops ADD COLUMN website_url TEXT");
  }
}

function ensureStopPhoneColumn(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(stops)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "phone")) {
    db.exec("ALTER TABLE stops ADD COLUMN phone TEXT");
  }
}

function ensureMapPoiContactColumns(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(map_pois)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "website_url")) {
    db.exec("ALTER TABLE map_pois ADD COLUMN website_url TEXT");
  }
  if (!cols.some((c) => c.name === "phone")) {
    db.exec("ALTER TABLE map_pois ADD COLUMN phone TEXT");
  }
}

function ensureStopWaypointRoleColumn(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(stops)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "waypoint_role")) {
    db.exec("ALTER TABLE stops ADD COLUMN waypoint_role TEXT");
    migrateStopWaypointRolesInitial(db);
  }
}

function ensureStopLegIndexColumn(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(stops)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "leg_index")) {
    db.exec("ALTER TABLE stops ADD COLUMN leg_index INTEGER NOT NULL DEFAULT 0");
  }
}

/** Risposte Overpass (acqua / rifugi) per bbox, per ridurre timeout 504 lato pubblico. */
function ensureOsmOverpassCacheTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS osm_overpass_cache (
      cache_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('water','services')),
      south REAL NOT NULL,
      west REAL NOT NULL,
      north REAL NOT NULL,
      east REAL NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_osm_cache_kind_time ON osm_overpass_cache(kind, fetched_at);
  `);
}

/** TTL cache OSM (ms). */
export const OSM_OVERPASS_CACHE_TTL_MS = 48 * 60 * 60 * 1000;

/** Chiave stabile per la bbox effettivamente interrogata su Overpass (dopo padding server). */
export function osmOverpassCacheKey(
  kind: "water" | "services",
  south: number,
  west: number,
  north: number,
  east: number
): string {
  const q = (n: number) => n.toFixed(4);
  return `${kind}:${q(south)}:${q(west)}:${q(north)}:${q(east)}`;
}

/** Cache per query lungo percorso (campione + raggio corridoio). */
export function osmPathQueryCacheKey(
  kind: "water" | "services",
  sampledCoords: Position[],
  radiusM: number
): string {
  const payload = sampledCoords.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join("|");
  const h = createHash("sha256").update(payload).digest("hex").slice(0, 40);
  return `${kind}_path:r${radiusM}:${h}`;
}

export function getOsmOverpassCachePayload(cacheKey: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload_json, fetched_at FROM osm_overpass_cache WHERE cache_key = ?`)
    .get(cacheKey) as { payload_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.fetched_at > OSM_OVERPASS_CACHE_TTL_MS) {
    return null;
  }
  return row.payload_json;
}

/** Come sopra ma non elimina: serve se Overpass è down (504) per servire dati vecchi. */
export function getOsmOverpassCachePayloadAllowStale(
  cacheKey: string
): { payload_json: string; stale: boolean } | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload_json, fetched_at FROM osm_overpass_cache WHERE cache_key = ?`)
    .get(cacheKey) as { payload_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  const stale = Date.now() - row.fetched_at > OSM_OVERPASS_CACHE_TTL_MS;
  return { payload_json: row.payload_json, stale };
}

export function setOsmOverpassCachePayload(
  cacheKey: string,
  kind: "water" | "services",
  south: number,
  west: number,
  north: number,
  east: number,
  payloadJson: string
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO osm_overpass_cache (cache_key, kind, south, west, north, east, payload_json, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload_json = excluded.payload_json,
       fetched_at = excluded.fetched_at,
       kind = excluded.kind,
       south = excluded.south,
       west = excluded.west,
       north = excluded.north,
       east = excluded.east`
  ).run(cacheKey, kind, south, west, north, east, payloadJson, Date.now());
}

/** Pulizia occasionale di record scaduti (mantiene il file DB leggero). */
export function pruneExpiredOsmOverpassCache(): number {
  const db = getDb();
  const cutoff = Date.now() - OSM_OVERPASS_CACHE_TTL_MS;
  const r = db.prepare(`DELETE FROM osm_overpass_cache WHERE fetched_at < ?`).run(cutoff);
  return r.changes;
}

/** Prima migrazione: assegna ruoli da ordine e segment_type. */
function migrateStopWaypointRolesInitial(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT id, itinerary_id, order_index, segment_type FROM stops ORDER BY itinerary_id, order_index ASC, name ASC`
    )
    .all() as Array<{
      id: string;
      itinerary_id: string;
      order_index: number;
      segment_type: string;
    }>;
  const byIt = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byIt.has(r.itinerary_id)) byIt.set(r.itinerary_id, []);
    byIt.get(r.itinerary_id)!.push(r);
  }
  const upd = db.prepare(`UPDATE stops SET waypoint_role = ? WHERE id = ?`);
  for (const list of byIt.values()) {
    list.sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id));
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const r = list[i];
      let role: WaypointRole;
      if (n === 1) role = "trip_start";
      else if (i === 0) role = "trip_start";
      else if (i === n - 1) role = "trip_end";
      else role = r.segment_type === "poi" ? "poi" : "via";
      upd.run(role, r.id);
    }
  }
}

/**
 * Assegna ruoli in base all’ordine globale e alle giornate (`leg_index`):
 * trip_start / trip_end agli estremi dell’itinerario; leg_start / leg_end ai confini tra giornate;
 * passaggi da segment_type.
 */
export function normalizeWaypointRolesAfterMutation(itineraryId: string) {
  const db = getDb();
  const stops = listStops(itineraryId);
  if (stops.length === 0) return;
  const sorted = sortStopsByOrder(stops);
  const total = sorted.length;
  const maxLeg = Math.max(...sorted.map((s) => s.leg_index ?? 0));
  const upd = db.prepare(
    `UPDATE stops SET waypoint_role = ? WHERE id = ? AND itinerary_id = ?`
  );
  db.transaction(() => {
    if (total === 1) {
      upd.run("trip_start", sorted[0].id, itineraryId);
      return;
    }
    for (let gi = 0; gi < total; gi++) {
      const s = sorted[gi];
      const L = s.leg_index ?? 0;
      const sameLeg = sorted.filter((x) => (x.leg_index ?? 0) === L);
      const n = sameLeg.length;
      const i = sameLeg.findIndex((x) => x.id === s.id);

      let role: WaypointRole;
      if (gi === 0) role = "trip_start";
      else if (gi === total - 1) role = "trip_end";
      else if (i === 0 && L > 0) role = "leg_start";
      else if (i === n - 1 && L < maxLeg) role = "leg_end";
      else role = s.segment_type === "poi" ? "poi" : "via";
      upd.run(role, s.id, itineraryId);
    }
  })();
}

function ensureRouteVariantsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_variants (
      id TEXT PRIMARY KEY,
      itinerary_id TEXT NOT NULL,
      label TEXT NOT NULL,
      line_geojson TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (itinerary_id) REFERENCES itineraries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_route_variants_itinerary ON route_variants(itinerary_id);
  `);
}

function ensureItineraryActiveRouteVariantColumn(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(itineraries)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "active_route_variant_id")) {
    db.exec("ALTER TABLE itineraries ADD COLUMN active_route_variant_id TEXT");
  }
}

function ensureSocialTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      handle TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'standard' CHECK (role IN ('standard','guide','operator','club_admin')),
      cert_metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      peer_user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, peer_user_id),
      CHECK (user_id != peer_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (peer_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
    CREATE INDEX IF NOT EXISTS idx_friendships_peer ON friendships(peer_user_id);

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('friends_circle','club','global_feed')),
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (follower_user_id, target_user_id),
      FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      line_geojson TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      bbox_json TEXT NOT NULL DEFAULT '{}',
      activity_kind TEXT NOT NULL DEFAULT 'hiking',
      region TEXT,
      source TEXT NOT NULL DEFAULT 'user_import',
      promoted_from_itinerary_id TEXT,
      created_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_routes_created_by ON routes(created_by_user_id);

    CREATE TABLE IF NOT EXISTS outings (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('private','friends','group','followers','public')),
      group_id TEXT,
      snow_conditions_text TEXT,
      weather_snapshot_json TEXT,
      notes TEXT,
      itinerary_id TEXT,
      track_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL,
      FOREIGN KEY (itinerary_id) REFERENCES itineraries(id) ON DELETE SET NULL,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outings_started ON outings(started_at);
    CREATE INDEX IF NOT EXISTS idx_outings_route ON outings(route_id);
    CREATE INDEX IF NOT EXISTS idx_outings_author ON outings(author_user_id);

    CREATE TABLE IF NOT EXISTS outing_participants (
      outing_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (outing_id, user_id),
      FOREIGN KEY (outing_id) REFERENCES outings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS outing_media (
      id TEXT PRIMARY KEY,
      outing_id TEXT NOT NULL,
      url TEXT NOT NULL,
      caption TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (outing_id) REFERENCES outings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS outing_poi_notes (
      id TEXT PRIMARY KEY,
      outing_id TEXT NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (outing_id) REFERENCES outings(id) ON DELETE CASCADE
    );
  `);
}

function seedSocialDemoIfEmpty(db: Database.Database) {
  const c = db.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number };
  if (c.n > 0) return;

  const lineFunes: [number, number][] = [
    [11.719, 46.641],
    [11.725, 46.645],
    [11.732, 46.648],
  ];
  const lineBrenta: [number, number][] = [
    [10.89, 46.185],
    [10.895, 46.188],
    [10.902, 46.192],
  ];

  const feat = (coords: [number, number][]) =>
    JSON.stringify({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    });

  const bbox = (coords: [number, number][]) => {
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    return JSON.stringify({
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
    });
  };

  const insUser = db.prepare(
    `INSERT INTO users (id, display_name, handle, role, cert_metadata_json) VALUES (?, ?, ?, ?, ?)`
  );
  insUser.run(DEMO_USER_SELF, "Tu (demo)", "tu_demo", "standard", null);
  insUser.run(DEMO_USER_MARTINO, "Martino", "martino", "standard", null);
  insUser.run(DEMO_USER_GIULIA, "Giulia", "giulia", "standard", null);
  insUser.run(DEMO_USER_ANA, "Ana", "ana", "standard", null);
  insUser.run(
    DEMO_USER_GUIDE_LUCA,
    "Luca Guida",
    "luca_guida",
    "guide",
    JSON.stringify({ label: "Guida alpina (demo)" })
  );

  const insFriend = db.prepare(
    `INSERT INTO friendships (id, user_id, peer_user_id, status) VALUES (?, ?, ?, 'accepted')`
  );
  insFriend.run(uuidv4(), DEMO_USER_SELF, DEMO_USER_MARTINO);
  insFriend.run(uuidv4(), DEMO_USER_SELF, DEMO_USER_GIULIA);
  insFriend.run(uuidv4(), DEMO_USER_SELF, DEMO_USER_ANA);

  db.prepare(
    `INSERT INTO follows (follower_user_id, target_user_id) VALUES (?, ?)`
  ).run(DEMO_USER_SELF, DEMO_USER_GUIDE_LUCA);

  db.prepare(
    `INSERT INTO groups (id, name, slug, kind, description) VALUES (?, ?, ?, 'club', ?)`
  ).run(
    DEMO_GROUP_CAI,
    "CAI Sezione Demo",
    "cai-demo",
    "Gruppo di prova per contenuti condivisi nel POC."
  );

  db.prepare(`INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)`).run(
    DEMO_GROUP_CAI,
    DEMO_USER_SELF,
    "member"
  );
  db.prepare(`INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)`).run(
    DEMO_GROUP_CAI,
    DEMO_USER_GUIDE_LUCA,
    "admin"
  );

  const routeFunes = uuidv4();
  const routeBrenta = uuidv4();
  db.prepare(
    `INSERT INTO routes (id, name, line_geojson, summary, bbox_json, activity_kind, region, source, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, 'hiking', 'Alto Adige', 'club_seed', ?)`
  ).run(
    routeFunes,
    "Anello Val di Funes (demo)",
    feat(lineFunes),
    "Sentiero panoramico facile.",
    bbox(lineFunes),
    DEMO_USER_GUIDE_LUCA
  );
  db.prepare(
    `INSERT INTO routes (id, name, line_geojson, summary, bbox_json, activity_kind, region, source, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, 'ski_mountaineering', 'Trentino', 'club_seed', ?)`
  ).run(
    routeBrenta,
    "Avvicinamento Brentei (demo)",
    feat(lineBrenta),
    "Linea semplificata per demo sociale.",
    bbox(lineBrenta),
    DEMO_USER_GUIDE_LUCA
  );

  const lineSelf: [number, number][] = [
    [11.5, 46.55],
    [11.51, 46.56],
    [11.52, 46.57],
  ];
  const routeSelf = uuidv4();
  db.prepare(
    `INSERT INTO routes (id, name, line_geojson, summary, bbox_json, activity_kind, region, source, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, 'hiking', 'Alto Adige', 'user_seed', ?)`
  ).run(
    routeSelf,
    "Giro laghi demo (mio)",
    feat(lineSelf),
    "Percorso seed per l’hub utente.",
    bbox(lineSelf),
    DEMO_USER_SELF
  );

  const daysAgo = (d: number) => {
    const dt = new Date();
    dt.setDate(dt.getDate() - d);
    return dt.toISOString().slice(0, 10) + "T08:00:00.000Z";
  };

  const insOut = db.prepare(
    `INSERT INTO outings (id, route_id, author_user_id, started_at, visibility, group_id, snow_conditions_text, weather_snapshot_json, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const o1 = uuidv4();
  const o2 = uuidv4();
  const o3 = uuidv4();
  const o4 = uuidv4();
  insOut.run(
    o1,
    routeFunes,
    DEMO_USER_MARTINO,
    daysAgo(5),
    "friends",
    null,
    null,
    JSON.stringify({ summary: "Sereno, vento debole" }),
    "Bellissima giornata; fango asciutto sui sentieri bassi."
  );
  insOut.run(
    o2,
    routeBrenta,
    DEMO_USER_GUIDE_LUCA,
    daysAgo(2),
    "public",
    null,
    "Neve trasformata in quota; attenzione lastroni.",
    JSON.stringify({ temp_c: -4, wind: "moderato" }),
    "Proposta uscita per il gruppo — condizioni tipiche invernali."
  );
  insOut.run(
    o3,
    routeFunes,
    DEMO_USER_GIULIA,
    daysAgo(1),
    "group",
    DEMO_GROUP_CAI,
    null,
    JSON.stringify({ clouds: "pochi" }),
    "Riunione CAI demo: percorso asciutto."
  );
  insOut.run(
    o4,
    routeSelf,
    DEMO_USER_SELF,
    daysAgo(3),
    "friends",
    null,
    null,
    JSON.stringify({ note: "demo hub" }),
    "Uscita di prova registrata per l’hub utente."
  );

  db.prepare(`INSERT INTO outing_participants (outing_id, user_id) VALUES (?, ?)`).run(
    o1,
    DEMO_USER_SELF
  );
}

function ensureProfileActiveUserColumn(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(profile)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "active_user_id")) {
    db.exec("ALTER TABLE profile ADD COLUMN active_user_id TEXT");
  }
  const hasUser = db.prepare("SELECT id FROM users WHERE id = ?").get(DEMO_USER_SELF);
  if (hasUser) {
    db.prepare("UPDATE profile SET active_user_id = ? WHERE id = 1 AND active_user_id IS NULL").run(
      DEMO_USER_SELF
    );
  }
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT NOT NULL DEFAULT 'Escursionista',
      units TEXT NOT NULL DEFAULT 'km' CHECK (units IN ('km','mi')),
      sports_json TEXT NOT NULL DEFAULT '[]',
      rain_mm_h REAL NOT NULL DEFAULT 2,
      wind_ms REAL NOT NULL DEFAULT 15,
      frost_temp_c REAL NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL DEFAULT 'Europe/Rome'
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      itinerary_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS itineraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      activity TEXT NOT NULL DEFAULT 'hiking',
      line_geojson TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stops (
      id TEXT PRIMARY KEY,
      itinerary_id TEXT NOT NULL,
      segment_type TEXT NOT NULL,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      notes TEXT,
      FOREIGN KEY (itinerary_id) REFERENCES itineraries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS explore_places (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      rating REAL NOT NULL DEFAULT 4.5,
      review_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_stops_itinerary ON stops(itinerary_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      itinerary_id TEXT REFERENCES itineraries(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT 'gpx_upload',
      point_count INTEGER NOT NULL,
      distance_m REAL NOT NULL,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      elev_loss_m REAL NOT NULL DEFAULT 0,
      bbox_json TEXT NOT NULL,
      duration_sec INTEGER,
      display_point_count INTEGER NOT NULL,
      display_line_geojson TEXT NOT NULL,
      has_elevation INTEGER NOT NULL DEFAULT 0,
      encoded_preview TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_itinerary ON tracks(itinerary_id);

    CREATE TABLE IF NOT EXISTS map_pois (
      id TEXT PRIMARY KEY,
      itinerary_id TEXT NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      category TEXT NOT NULL DEFAULT 'other',
      source TEXT NOT NULL DEFAULT 'chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (itinerary_id) REFERENCES itineraries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_map_pois_itinerary ON map_pois(itinerary_id);
  `);
}

function ensureDefaultProfile(db: Database.Database) {
  const row = db.prepare("SELECT id FROM profile WHERE id = 1").get();
  if (!row) {
    db.prepare(
      `INSERT INTO profile (id, display_name, units, sports_json, rain_mm_h, wind_ms, frost_temp_c, timezone)
       VALUES (1, 'Escursionista', 'km', '["hiking","mtb"]', 2, 15, 0, 'Europe/Rome')`
    ).run();
  }
}

function seedExploreIfEmpty(db: Database.Database) {
  const c = db.prepare("SELECT COUNT(*) as n FROM explore_places").get() as { n: number };
  if (c.n > 0) return;
  const places: Omit<ExplorePlaceRow, "id">[] = [
    {
      name: "Rifugio Brentei",
      lat: 46.1892,
      lng: 10.8944,
      description: "Base classica per le Dolomiti di Brenta; cucina e panorama.",
      image_url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80",
      rating: 4.8,
      review_count: 124,
    },
    {
      name: "Passo dello Stelvio",
      lat: 46.5286,
      lng: 10.4528,
      description: "Salita iconica in bici; attenzione meteo e neve fuori stagione.",
      image_url: "https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&q=80",
      rating: 4.9,
      review_count: 890,
    },
    {
      name: "Val di Funes",
      lat: 46.6408,
      lng: 11.7194,
      description: "Sentieri dolci e viste sulle Odle; ideale trekking famiglia.",
      image_url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80",
      rating: 4.7,
      review_count: 210,
    },
  ];
  const ins = db.prepare(
    `INSERT INTO explore_places (id, name, lat, lng, description, image_url, rating, review_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const p of places) {
    ins.run(uuidv4(), p.name, p.lat, p.lng, p.description, p.image_url, p.rating, p.review_count);
  }
}

export function getProfile(): ProfileRow {
  const db = getDb();
  return db.prepare("SELECT * FROM profile WHERE id = 1").get() as ProfileRow;
}

export function updateProfile(p: Partial<Omit<ProfileRow, "id">>) {
  const db = getDb();
  const cur = getProfile();
  if (p.active_user_id !== undefined && p.active_user_id) {
    const u = db.prepare("SELECT id FROM users WHERE id = ?").get(p.active_user_id);
    if (!u) throw new Error("active_user_id: utente non trovato");
  }
  const active_user_id =
    p.active_user_id !== undefined ? p.active_user_id : (cur.active_user_id ?? null);
  db.prepare(
    `UPDATE profile SET
      display_name = ?,
      units = ?,
      sports_json = ?,
      rain_mm_h = ?,
      wind_ms = ?,
      frost_temp_c = ?,
      timezone = ?,
      active_user_id = ?
     WHERE id = 1`
  ).run(
    p.display_name ?? cur.display_name,
    p.units ?? cur.units,
    p.sports_json ?? cur.sports_json,
    p.rain_mm_h ?? cur.rain_mm_h,
    p.wind_ms ?? cur.wind_ms,
    p.frost_temp_c ?? cur.frost_temp_c,
    p.timezone ?? cur.timezone,
    active_user_id
  );
}

export function setProfileActiveUserId(userId: string | null): ProfileRow {
  const db = getDb();
  if (userId) {
    const u = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    if (!u) throw new Error("Utente non trovato");
  }
  db.prepare("UPDATE profile SET active_user_id = ? WHERE id = 1").run(userId);
  return getProfile();
}

export function listUsers(): UserRow[] {
  return getDb().prepare("SELECT * FROM users ORDER BY display_name ASC").all() as UserRow[];
}

/** Amicizie accettate (POC: tabella friendships). */
export function listFriendUsers(forUserId: string): UserRow[] {
  const db = getDb();
  const ids = db
    .prepare(
      `SELECT peer_user_id AS id FROM friendships WHERE user_id = ? AND status = 'accepted'
       UNION
       SELECT user_id AS id FROM friendships WHERE peer_user_id = ? AND status = 'accepted'`
    )
    .all(forUserId, forUserId) as { id: string }[];
  const out: UserRow[] = [];
  const seen = new Set<string>();
  for (const { id } of ids) {
    if (id === forUserId || seen.has(id)) continue;
    seen.add(id);
    const u = getUser(id);
    if (u) out.push(u);
  }
  return out.sort((a, b) => a.display_name.localeCompare(b.display_name, "it"));
}

/** Account seguiti dal viewer (tabella follows). */
export function listFollowingUsers(forUserId: string): UserRow[] {
  return getDb()
    .prepare(
      `SELECT u.* FROM follows f
       JOIN users u ON u.id = f.target_user_id
       WHERE f.follower_user_id = ?
       ORDER BY u.display_name COLLATE NOCASE ASC`
    )
    .all(forUserId) as UserRow[];
}

export function getUser(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function getActiveUserId(): string | null {
  const p = getProfile();
  return p.active_user_id ?? null;
}

export function listGroups(): GroupRow[] {
  return getDb().prepare("SELECT * FROM groups ORDER BY name ASC").all() as GroupRow[];
}

export type OutingFeedRow = OutingRow & {
  route_line_geojson: string;
  route_name: string;
  author_display_name: string;
};

/** Outing visibili alla mappa per il viewer (POC: regole semplificate). */
export function listOutingsForMapFeed(params: {
  viewerUserId: string;
  layer: "friends" | "group" | "following" | "public";
  groupId?: string | null;
  maxDays?: number;
}): OutingFeedRow[] {
  const db = getDb();
  const maxDays = params.maxDays ?? 45;
  const since = `datetime('now', '-${maxDays} days')`;

  if (params.layer === "public") {
    return db
      .prepare(
        `SELECT o.*, r.line_geojson AS route_line_geojson, r.name AS route_name, u.display_name AS author_display_name
         FROM outings o
         JOIN routes r ON o.route_id = r.id
         JOIN users u ON o.author_user_id = u.id
         WHERE o.started_at >= ${since}
           AND o.visibility = 'public'
         ORDER BY o.started_at DESC
         LIMIT 80`
      )
      .all() as OutingFeedRow[];
  }

  if (params.layer === "group" && params.groupId) {
    return db
      .prepare(
        `SELECT o.*, r.line_geojson AS route_line_geojson, r.name AS route_name, u.display_name AS author_display_name
         FROM outings o
         JOIN routes r ON o.route_id = r.id
         JOIN users u ON o.author_user_id = u.id
         JOIN group_members gm ON gm.group_id = o.group_id AND gm.user_id = ?
         WHERE o.started_at >= ${since}
           AND o.visibility = 'group'
           AND o.group_id = ?
         ORDER BY o.started_at DESC
         LIMIT 80`
      )
      .all(params.viewerUserId, params.groupId) as OutingFeedRow[];
  }

  if (params.layer === "following") {
    return db
      .prepare(
        `SELECT o.*, r.line_geojson AS route_line_geojson, r.name AS route_name, u.display_name AS author_display_name
         FROM outings o
         JOIN routes r ON o.route_id = r.id
         JOIN users u ON o.author_user_id = u.id
         JOIN follows f ON f.target_user_id = o.author_user_id AND f.follower_user_id = ?
         WHERE o.started_at >= ${since}
           AND o.visibility IN ('public', 'followers')
         ORDER BY o.started_at DESC
         LIMIT 80`
      )
      .all(params.viewerUserId) as OutingFeedRow[];
  }

  // friends: io pubblico, amici con visibility friends/public, gruppo CAI se visibile
  return db
    .prepare(
      `SELECT DISTINCT o.*, r.line_geojson AS route_line_geojson, r.name AS route_name, u.display_name AS author_display_name
       FROM outings o
       JOIN routes r ON o.route_id = r.id
       JOIN users u ON o.author_user_id = u.id
       WHERE o.started_at >= ${since}
         AND (
           o.author_user_id = ?
           OR (
             o.visibility IN ('public', 'friends')
             AND (
               EXISTS (
                 SELECT 1 FROM friendships fr
                 WHERE fr.status = 'accepted'
                   AND (
                     (fr.user_id = ? AND fr.peer_user_id = o.author_user_id)
                     OR (fr.peer_user_id = ? AND fr.user_id = o.author_user_id)
                   )
               )
             )
           )
           OR (
             o.visibility = 'group'
             AND o.group_id IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM group_members gm2
               WHERE gm2.group_id = o.group_id AND gm2.user_id = ?
             )
           )
         )
       ORDER BY o.started_at DESC
       LIMIT 80`
    )
    .all(
      params.viewerUserId,
      params.viewerUserId,
      params.viewerUserId,
      params.viewerUserId
    ) as OutingFeedRow[];
}

export function listCanonicalRoutes(limit = 50): CanonicalRouteRow[] {
  return getDb()
    .prepare("SELECT * FROM routes ORDER BY created_at DESC LIMIT ?")
    .all(limit) as CanonicalRouteRow[];
}

/** Percorsi canonici creati dall’utente (social). */
export function listCanonicalRoutesForUser(userId: string, limit = 40): CanonicalRouteRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM routes WHERE created_by_user_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(userId, limit) as CanonicalRouteRow[];
}

export function getCanonicalRoute(id: string): CanonicalRouteRow | undefined {
  return getDb().prepare("SELECT * FROM routes WHERE id = ?").get(id) as CanonicalRouteRow | undefined;
}

export function listOutingsForRoute(routeId: string, limit = 20): OutingRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM outings WHERE route_id = ? ORDER BY started_at DESC LIMIT ?"
    )
    .all(routeId, limit) as OutingRow[];
}

export type OutingWithAuthor = OutingRow & { author_display_name: string };

export function listOutingsForRouteWithAuthors(routeId: string, limit = 15): OutingWithAuthor[] {
  return getDb()
    .prepare(
      `SELECT o.*, u.display_name AS author_display_name
       FROM outings o
       JOIN users u ON o.author_user_id = u.id
       WHERE o.route_id = ?
       ORDER BY o.started_at DESC
       LIMIT ?`
    )
    .all(routeId, limit) as OutingWithAuthor[];
}

/** Uscite in cui l’utente è autore o partecipante. */
export function listOutingsForUser(userId: string, limit = 50): OutingForUserListRow[] {
  return getDb()
    .prepare(
      `SELECT o.*, r.name AS route_name, u.display_name AS author_display_name,
        CASE WHEN o.author_user_id = ? THEN 'author' ELSE 'participant' END AS role
       FROM outings o
       JOIN routes r ON o.route_id = r.id
       JOIN users u ON o.author_user_id = u.id
       WHERE o.author_user_id = ? OR EXISTS (
         SELECT 1 FROM outing_participants op
         WHERE op.outing_id = o.id AND op.user_id = ?
       )
       ORDER BY o.started_at DESC
       LIMIT ?`
    )
    .all(userId, userId, userId, limit) as OutingForUserListRow[];
}

export function searchCanonicalRoutesByName(query: string, limit = 15): CanonicalRouteRow[] {
  const t = query.trim();
  if (!t) return listCanonicalRoutes(limit);
  const q = `%${t}%`;
  return getDb()
    .prepare(
      "SELECT * FROM routes WHERE name LIKE ? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?"
    )
    .all(q, limit) as CanonicalRouteRow[];
}

function bboxFromLineFeatureJson(lineJson: string): string {
  try {
    const o = JSON.parse(lineJson) as { geometry?: { coordinates?: [number, number][] } };
    const coords = o.geometry?.coordinates;
    if (!coords?.length) return "{}";
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    return JSON.stringify({
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
    });
  } catch {
    return "{}";
  }
}

export function insertCanonicalRoute(input: {
  name: string;
  line_geojson: string;
  summary?: string;
  activity_kind?: string;
  region?: string | null;
  source?: string;
  created_by_user_id?: string | null;
  bbox_json?: string;
  promoted_from_itinerary_id?: string | null;
}): CanonicalRouteRow {
  const db = getDb();
  const id = uuidv4();
  const bbox =
    input.bbox_json ?? bboxFromLineFeatureJson(input.line_geojson);
  db.prepare(
    `INSERT INTO routes (id, name, line_geojson, summary, bbox_json, activity_kind, region, source, created_by_user_id, promoted_from_itinerary_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.line_geojson,
    input.summary ?? "",
    bbox,
    input.activity_kind ?? "hiking",
    input.region ?? null,
    input.source ?? "user_import",
    input.created_by_user_id ?? null,
    input.promoted_from_itinerary_id ?? null
  );
  return getCanonicalRoute(id)!;
}

export function insertOuting(input: {
  route_id: string;
  author_user_id: string;
  started_at: string;
  visibility: string;
  group_id?: string | null;
  snow_conditions_text?: string | null;
  weather_snapshot_json?: string | null;
  notes?: string | null;
  itinerary_id?: string | null;
  track_id?: string | null;
  participant_user_ids?: string[];
}): OutingRow {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO outings (id, route_id, author_user_id, started_at, visibility, group_id, snow_conditions_text, weather_snapshot_json, notes, itinerary_id, track_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.route_id,
    input.author_user_id,
    input.started_at,
    input.visibility,
    input.group_id ?? null,
    input.snow_conditions_text ?? null,
    input.weather_snapshot_json ?? null,
    input.notes ?? null,
    input.itinerary_id ?? null,
    input.track_id ?? null
  );
  for (const uid of input.participant_user_ids ?? []) {
    db.prepare(`INSERT OR IGNORE INTO outing_participants (outing_id, user_id) VALUES (?, ?)`).run(
      id,
      uid
    );
  }
  return db.prepare("SELECT * FROM outings WHERE id = ?").get(id) as OutingRow;
}

export function listItineraries(): ItineraryRow[] {
  return getDb().prepare("SELECT * FROM itineraries ORDER BY created_at DESC").all() as ItineraryRow[];
}

export function getItinerary(id: string): ItineraryRow | undefined {
  return getDb().prepare("SELECT * FROM itineraries WHERE id = ?").get(id) as ItineraryRow | undefined;
}

export function createItinerary(input: {
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  activity?: ActivityType | string;
  line_geojson?: string | null;
}): ItineraryRow {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO itineraries (id, name, start_date, end_date, activity, line_geojson, active_route_variant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.start_date ?? null,
    input.end_date ?? null,
    input.activity ?? "hiking",
    input.line_geojson ?? null,
    null
  );
  return getItinerary(id)!;
}

export function upsertItineraryFull(input: {
  id?: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  activity?: string;
  line_geojson?: string | null;
  safety_checklist_json?: string | null;
  planner_notes?: string | null;
}): ItineraryRow {
  const db = getDb();
  if (input.id) {
    const ex = getItinerary(input.id);
    if (ex) {
      const line =
        input.line_geojson !== undefined ? input.line_geojson : ex.line_geojson;
      const safety =
        input.safety_checklist_json !== undefined
          ? input.safety_checklist_json
          : ex.safety_checklist_json ?? null;
      const notes =
        input.planner_notes !== undefined ? input.planner_notes : ex.planner_notes ?? null;
      db.prepare(
        `UPDATE itineraries SET name = ?, start_date = ?, end_date = ?, activity = ?, line_geojson = ?,
         safety_checklist_json = ?, planner_notes = ?
         WHERE id = ?`
      ).run(
        input.name,
        input.start_date ?? ex.start_date,
        input.end_date ?? ex.end_date,
        input.activity ?? ex.activity,
        line,
        safety,
        notes,
        input.id
      );
      return getItinerary(input.id)!;
    }
  }
  return createItinerary({
    name: input.name,
    start_date: input.start_date,
    end_date: input.end_date,
    activity: input.activity,
    line_geojson: input.line_geojson,
  });
}

export function updateItineraryLine(id: string, line_geojson: string | null) {
  const db = getDb();
  db.prepare("UPDATE itineraries SET line_geojson = ? WHERE id = ?").run(line_geojson, id);
  const it = getItinerary(id);
  if (it?.active_route_variant_id && line_geojson) {
    db.prepare(
      "UPDATE route_variants SET line_geojson = ? WHERE id = ? AND itinerary_id = ?"
    ).run(line_geojson, it.active_route_variant_id, id);
  }
}

export function listRouteVariants(itineraryId: string): RouteVariantRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM route_variants WHERE itinerary_id = ? ORDER BY sort_order ASC, created_at ASC"
    )
    .all(itineraryId) as RouteVariantRow[];
}

export function getRouteVariant(id: string): RouteVariantRow | undefined {
  return getDb().prepare("SELECT * FROM route_variants WHERE id = ?").get(id) as
    | RouteVariantRow
    | undefined;
}

export function insertRouteVariant(input: {
  itinerary_id: string;
  label: string;
  line_geojson: string;
  sort_order?: number;
}): RouteVariantRow {
  const db = getDb();
  const id = uuidv4();
  let order = input.sort_order;
  if (order === undefined || !Number.isFinite(order)) {
    const row = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) AS m FROM route_variants WHERE itinerary_id = ?"
      )
      .get(input.itinerary_id) as { m: number };
    order = row.m + 1;
  }
  db.prepare(
    `INSERT INTO route_variants (id, itinerary_id, label, line_geojson, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.itinerary_id, input.label, input.line_geojson, order);
  return getRouteVariant(id)!;
}

/** Imposta la variante attiva e copia la sua geometria sulla linea principale dell’itinerario. */
export function setActiveRouteVariant(itineraryId: string, variantId: string): ItineraryRow | null {
  const v = getRouteVariant(variantId);
  if (!v || v.itinerary_id !== itineraryId) return null;
  const db = getDb();
  db.prepare(
    `UPDATE itineraries SET line_geojson = ?, active_route_variant_id = ? WHERE id = ?`
  ).run(v.line_geojson, variantId, itineraryId);
  return getItinerary(itineraryId)!;
}

export function deleteItinerary(id: string) {
  getDb().prepare("DELETE FROM itineraries WHERE id = ?").run(id);
}

function coerceStopRow(r: StopRow): StopRow {
  const leg_index = typeof r.leg_index === "number" ? r.leg_index : 0;
  const waypoint_role =
    r.waypoint_role ?? (r.segment_type === "poi" ? "poi" : "via");
  const phone =
    r.phone !== undefined && r.phone !== null ? r.phone : null;
  return { ...r, leg_index, waypoint_role, phone };
}

function coerceMapPoiRow(r: MapPoiRow): MapPoiRow {
  return {
    ...r,
    website_url: r.website_url ?? null,
    phone: r.phone ?? null,
  };
}

export function listStops(itineraryId: string): StopRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM stops WHERE itinerary_id = ? ORDER BY order_index ASC, name ASC")
    .all(itineraryId) as StopRow[];
  return rows.map(coerceStopRow);
}

export function listMapPois(itineraryId: string): MapPoiRow[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM map_pois WHERE itinerary_id = ? ORDER BY created_at DESC, name ASC"
    )
    .all(itineraryId) as MapPoiRow[];
  return rows.map(coerceMapPoiRow);
}

export function insertMapPoi(input: {
  itinerary_id: string;
  name: string;
  lat: number;
  lng: number;
  description?: string | null;
  image_url?: string | null;
  website_url?: string | null;
  phone?: string | null;
  category?: string;
  source?: string;
}): MapPoiRow {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO map_pois (id, itinerary_id, name, lat, lng, description, image_url, website_url, phone, category, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.itinerary_id,
    input.name,
    input.lat,
    input.lng,
    input.description ?? "",
    input.image_url ?? null,
    input.website_url ?? null,
    input.phone ?? null,
    input.category ?? "other",
    input.source ?? "chat"
  );
  return coerceMapPoiRow(db.prepare("SELECT * FROM map_pois WHERE id = ?").get(id) as MapPoiRow);
}

export function updateMapPoi(
  id: string,
  itineraryId: string,
  patch: {
    description?: string;
    image_url?: string | null;
    website_url?: string | null;
    phone?: string | null;
  }
): MapPoiRow | null {
  const ex = getDb()
    .prepare("SELECT * FROM map_pois WHERE id = ? AND itinerary_id = ?")
    .get(id, itineraryId) as MapPoiRow | undefined;
  if (!ex) return null;
  const description = patch.description !== undefined ? patch.description : ex.description;
  const image_url = patch.image_url !== undefined ? patch.image_url : ex.image_url;
  const website_url = patch.website_url !== undefined ? patch.website_url : ex.website_url;
  const phone = patch.phone !== undefined ? patch.phone : ex.phone;
  getDb()
    .prepare(
      `UPDATE map_pois SET description = ?, image_url = ?, website_url = ?, phone = ? WHERE id = ? AND itinerary_id = ?`
    )
    .run(description, image_url, website_url, phone, id, itineraryId);
  return coerceMapPoiRow(
    getDb().prepare("SELECT * FROM map_pois WHERE id = ?").get(id) as MapPoiRow
  );
}

export function getMapPoi(id: string, itineraryId: string): MapPoiRow | undefined {
  const r = getDb()
    .prepare("SELECT * FROM map_pois WHERE id = ? AND itinerary_id = ?")
    .get(id, itineraryId) as MapPoiRow | undefined;
  return r ? coerceMapPoiRow(r) : undefined;
}

export function deleteMapPoiForItinerary(poiId: string, itineraryId: string): boolean {
  const r = getDb()
    .prepare("DELETE FROM map_pois WHERE id = ? AND itinerary_id = ?")
    .run(poiId, itineraryId);
  return r.changes > 0;
}

export function getStop(id: string, itineraryId: string): StopRow | undefined {
  const r = getDb()
    .prepare("SELECT * FROM stops WHERE id = ? AND itinerary_id = ?")
    .get(id, itineraryId) as StopRow | undefined;
  return r ? coerceStopRow(r) : undefined;
}

export function updateStop(
  id: string,
  itineraryId: string,
  patch: {
    lat?: number;
    lng?: number;
    name?: string;
    notes?: string | null;
    image_url?: string | null;
    website_url?: string | null;
    phone?: string | null;
    segment_type?: string;
    waypoint_role?: WaypointRole;
    leg_index?: number;
  }
): StopRow | null {
  const ex = getStop(id, itineraryId);
  if (!ex) return null;
  const lat = patch.lat ?? ex.lat;
  const lng = patch.lng ?? ex.lng;
  const name = patch.name ?? ex.name;
  const notes = patch.notes !== undefined ? patch.notes : ex.notes;
  const image_url =
    patch.image_url !== undefined ? patch.image_url : (ex.image_url ?? null);
  const website_url =
    patch.website_url !== undefined ? patch.website_url : (ex.website_url ?? null);
  const phone = patch.phone !== undefined ? patch.phone : (ex.phone ?? null);
  const segment_type = patch.segment_type ?? ex.segment_type;
  const waypoint_role = patch.waypoint_role ?? ex.waypoint_role;
  const leg_index = patch.leg_index ?? ex.leg_index;
  getDb()
    .prepare(
      `UPDATE stops SET lat = ?, lng = ?, name = ?, notes = ?, image_url = ?, website_url = ?, phone = ?, segment_type = ?, waypoint_role = ?, leg_index = ?
       WHERE id = ? AND itinerary_id = ?`
    )
    .run(
      lat,
      lng,
      name,
      notes,
      image_url,
      website_url,
      phone,
      segment_type,
      waypoint_role,
      leg_index,
      id,
      itineraryId
    );
  return getStop(id, itineraryId) ?? null;
}

export function deleteStop(id: string, itineraryId: string): boolean {
  const r = getDb()
    .prepare("DELETE FROM stops WHERE id = ? AND itinerary_id = ?")
    .run(id, itineraryId);
  if (r.changes > 0) normalizeWaypointRolesAfterMutation(itineraryId);
  return r.changes > 0;
}

export function addStop(input: {
  itinerary_id: string;
  segment_type: string;
  name: string;
  lat: number;
  lng: number;
  order_index?: number;
  notes?: string | null;
  image_url?: string | null;
  website_url?: string | null;
  phone?: string | null;
  waypoint_role?: WaypointRole;
  leg_index?: number;
  /** Solo per replaceStopsFromTool / batch. */
  _skipNormalize?: boolean;
}): StopRow {
  const db = getDb();
  const id = uuidv4();
  const max = db
    .prepare("SELECT COALESCE(MAX(order_index), -1) as m FROM stops WHERE itinerary_id = ?")
    .get(input.itinerary_id) as { m: number };
  const order_index = input.order_index ?? max.m + 1;
  const initialRole =
    input.waypoint_role ??
    defaultWaypointRoleForSegmentType(input.segment_type as SegmentType);
  const leg_index = input.leg_index ?? 0;
  db.prepare(
    `INSERT INTO stops (id, itinerary_id, segment_type, waypoint_role, leg_index, name, order_index, lat, lng, notes, image_url, website_url, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.itinerary_id,
    input.segment_type,
    initialRole,
    leg_index,
    input.name,
    order_index,
    input.lat,
    input.lng,
    input.notes ?? null,
    input.image_url ?? null,
    input.website_url ?? null,
    input.phone ?? null
  );
  if (!input._skipNormalize) {
    normalizeWaypointRolesAfterMutation(input.itinerary_id);
  }
  return db.prepare("SELECT * FROM stops WHERE id = ?").get(id) as StopRow;
}

/** Inserisce una tappa a `insertionOrder` e incrementa `order_index` delle tappe già ≥ quel valore. */
export function addStopAtOrder(
  input: Omit<Parameters<typeof addStop>[0], "order_index" | "_skipNormalize">,
  insertionOrder: number
): StopRow {
  const db = getDb();
  const tid = input.itinerary_id;
  const row = db.transaction(() => {
    db.prepare(
      `UPDATE stops SET order_index = order_index + 1 WHERE itinerary_id = ? AND order_index >= ?`
    ).run(tid, insertionOrder);
    return addStop({ ...input, order_index: insertionOrder, _skipNormalize: true });
  })();
  normalizeWaypointRolesAfterMutation(tid);
  return row;
}

/** Riassegna `order_index` in base all’ordine degli ID (0..n-1). Deve coincidere esattamente l’insieme delle tappe. */
export function reorderStops(itineraryId: string, orderedIds: string[]): boolean {
  const db = getDb();
  const rows = db
    .prepare("SELECT id FROM stops WHERE itinerary_id = ?")
    .all(itineraryId) as { id: string }[];
  if (rows.length !== orderedIds.length) return false;
  const existing = new Set(rows.map((r) => r.id));
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!existing.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  db.transaction(() => {
    orderedIds.forEach((id, i) => {
      db.prepare("UPDATE stops SET order_index = ? WHERE id = ? AND itinerary_id = ?").run(
        i,
        id,
        itineraryId
      );
    });
  })();
  normalizeWaypointRolesAfterMutation(itineraryId);
  return true;
}

/** Riordina solo i punti della giornata `legIndex` (stesso insieme di ID). */
export function reorderStopsInLeg(itineraryId: string, legIndex: number, orderedIds: string[]): boolean {
  const stops = listStops(itineraryId);
  const sorted = sortStopsByOrder(stops);
  const inLeg = sorted.filter((s) => (s.leg_index ?? 0) === legIndex);
  if (inLeg.length !== orderedIds.length) return false;
  const set = new Set(inLeg.map((s) => s.id));
  for (const id of orderedIds) {
    if (!set.has(id)) return false;
  }
  const i0 = sorted.findIndex((s) => set.has(s.id));
  const i1 = sorted.findLastIndex((s) => set.has(s.id));
  if (i0 === -1) return false;
  for (let j = i0; j <= i1; j++) {
    if (!set.has(sorted[j].id)) return false;
  }
  const merged: StopRow[] = [
    ...sorted.slice(0, i0),
    ...orderedIds.map((id) => {
      const x = stops.find((s) => s.id === id);
      if (!x) throw new Error("stop");
      return x;
    }),
    ...sorted.slice(i1 + 1),
  ];
  const db = getDb();
  db.transaction(() => {
    merged.forEach((s, i) => {
      db.prepare("UPDATE stops SET order_index = ? WHERE id = ? AND itinerary_id = ?").run(
        i,
        s.id,
        itineraryId
      );
    });
  })();
  normalizeWaypointRolesAfterMutation(itineraryId);
  return true;
}

export function clearStops(itineraryId: string) {
  getDb().prepare("DELETE FROM stops WHERE itinerary_id = ?").run(itineraryId);
}

export function replaceStopsFromTool(
  itineraryId: string,
  stops: Array<{
    segment_type: string;
    name: string;
    lat: number;
    lng: number;
    notes?: string;
    waypoint_role?: WaypointRole;
  }>
) {
  clearStops(itineraryId);
  stops.forEach((s, i) => {
    addStop({
      itinerary_id: itineraryId,
      segment_type: s.segment_type,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      order_index: i,
      notes: s.notes ?? null,
      waypoint_role: s.waypoint_role,
      leg_index: 0,
      _skipNormalize: true,
    });
  });
  normalizeWaypointRolesAfterMutation(itineraryId);
}

export function getOrCreateChatSession(itineraryId?: string | null): string {
  const db = getDb();
  if (itineraryId) {
    const row = db
      .prepare("SELECT id FROM chat_sessions WHERE itinerary_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(itineraryId) as { id: string } | undefined;
    if (row) return row.id;
  }
  const id = uuidv4();
  db.prepare("INSERT INTO chat_sessions (id, itinerary_id) VALUES (?, ?)").run(id, itineraryId ?? null);
  return id;
}

export function ensureChatSession(sessionId: string, itineraryId: string | null) {
  const db = getDb();
  const row = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(sessionId);
  if (!row) {
    db.prepare("INSERT INTO chat_sessions (id, itinerary_id) VALUES (?, ?)").run(sessionId, itineraryId);
  } else if (itineraryId) {
    db.prepare("UPDATE chat_sessions SET itinerary_id = ? WHERE id = ?").run(itineraryId, sessionId);
  }
}

export function listMessages(sessionId: string) {
  return getDb()
    .prepare("SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as { id: string; role: string; content: string; created_at: string }[];
}

export function appendMessage(sessionId: string, role: "user" | "assistant", content: string) {
  const db = getDb();
  const id = uuidv4();
  db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)").run(
    id,
    sessionId,
    role,
    content
  );
}

export function clearMessagesForSession(sessionId: string) {
  getDb().prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
}

export function listExplorePlaces(): ExplorePlaceRow[] {
  return getDb().prepare("SELECT * FROM explore_places ORDER BY name ASC").all() as ExplorePlaceRow[];
}

export function insertExplorePlace(input: {
  name: string;
  lat: number;
  lng: number;
  description?: string;
  image_url?: string;
  rating?: number;
  review_count?: number;
}): ExplorePlaceRow {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO explore_places (id, name, lat, lng, description, image_url, rating, review_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name.trim(),
    input.lat,
    input.lng,
    input.description ?? "",
    input.image_url ?? "",
    input.rating ?? 4.5,
    input.review_count ?? 0
  );
  return db.prepare("SELECT * FROM explore_places WHERE id = ?").get(id) as ExplorePlaceRow;
}

export function updateExplorePlace(
  id: string,
  patch: Partial<
    Pick<ExplorePlaceRow, "name" | "lat" | "lng" | "description" | "image_url" | "rating" | "review_count">
  >
): ExplorePlaceRow | undefined {
  const db = getDb();
  const ex = db.prepare("SELECT * FROM explore_places WHERE id = ?").get(id) as ExplorePlaceRow | undefined;
  if (!ex) return undefined;
  const row = {
    name: patch.name !== undefined ? patch.name : ex.name,
    lat: patch.lat !== undefined ? patch.lat : ex.lat,
    lng: patch.lng !== undefined ? patch.lng : ex.lng,
    description: patch.description !== undefined ? patch.description : ex.description,
    image_url: patch.image_url !== undefined ? patch.image_url : ex.image_url,
    rating: patch.rating !== undefined ? patch.rating : ex.rating,
    review_count: patch.review_count !== undefined ? patch.review_count : ex.review_count,
  };
  db.prepare(
    `UPDATE explore_places SET name = ?, lat = ?, lng = ?, description = ?, image_url = ?, rating = ?, review_count = ?
     WHERE id = ?`
  ).run(
    row.name,
    row.lat,
    row.lng,
    row.description,
    row.image_url,
    row.rating,
    row.review_count,
    id
  );
  return db.prepare("SELECT * FROM explore_places WHERE id = ?").get(id) as ExplorePlaceRow;
}

export function deleteExplorePlace(id: string): boolean {
  const db = getDb();
  const r = db.prepare("DELETE FROM explore_places WHERE id = ?").run(id);
  return r.changes > 0;
}

/** Crea percorso canonico + uscita dall’itinerario (linea salvata). */
export function publishOutingFromItinerary(input: {
  itinerary_id: string;
  author_user_id: string;
  started_at: string;
  visibility: string;
  group_id?: string | null;
  notes?: string | null;
  snow_conditions_text?: string | null;
  weather_snapshot_json?: string | null;
}): { route: CanonicalRouteRow; outing: OutingRow } {
  const it = getItinerary(input.itinerary_id);
  if (!it) throw new Error("Itinerario non trovato");
  if (!it.line_geojson?.trim()) {
    throw new Error("Serve una traccia sulla mappa (linea o GPX)");
  }
  const track = getLatestTrackForItinerary(input.itinerary_id);
  const route = insertCanonicalRoute({
    name: `${it.name} (da itinerario)`,
    line_geojson: it.line_geojson,
    summary: it.planner_notes?.trim() || `Pubblicato dall’itinerario ${it.name}`,
    activity_kind: typeof it.activity === "string" ? it.activity : "hiking",
    source: "itinerary_publish",
    created_by_user_id: input.author_user_id,
    promoted_from_itinerary_id: input.itinerary_id,
  });
  const outing = insertOuting({
    route_id: route.id,
    author_user_id: input.author_user_id,
    started_at: input.started_at,
    visibility: input.visibility,
    group_id: input.group_id ?? null,
    snow_conditions_text: input.snow_conditions_text ?? null,
    weather_snapshot_json: input.weather_snapshot_json ?? null,
    notes: input.notes ?? null,
    itinerary_id: input.itinerary_id,
    track_id: track?.id ?? null,
  });
  return { route, outing };
}

export function insertTrack(row: {
  id: string;
  itinerary_id: string | null;
  source?: string;
  point_count: number;
  distance_m: number;
  elev_gain_m: number;
  elev_loss_m: number;
  bbox_json: string;
  duration_sec: number | null;
  display_point_count: number;
  display_line_geojson: string;
  has_elevation: boolean;
  encoded_preview: string;
}): TrackRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO tracks (
      id, itinerary_id, source, point_count, distance_m, elev_gain_m, elev_loss_m,
      bbox_json, duration_sec, display_point_count, display_line_geojson, has_elevation, encoded_preview
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.itinerary_id,
    row.source ?? "gpx_upload",
    row.point_count,
    row.distance_m,
    row.elev_gain_m,
    row.elev_loss_m,
    row.bbox_json,
    row.duration_sec,
    row.display_point_count,
    row.display_line_geojson,
    row.has_elevation ? 1 : 0,
    row.encoded_preview
  );
  return getTrack(row.id)!;
}

export function getTrack(id: string): TrackRow | undefined {
  return getDb().prepare("SELECT * FROM tracks WHERE id = ?").get(id) as TrackRow | undefined;
}

export function listTracksForItinerary(itineraryId: string): TrackRow[] {
  return getDb()
    .prepare("SELECT * FROM tracks WHERE itinerary_id = ? ORDER BY created_at DESC")
    .all(itineraryId) as TrackRow[];
}

export function getLatestTrackForItinerary(itineraryId: string): TrackRow | undefined {
  return getDb()
    .prepare("SELECT * FROM tracks WHERE itinerary_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(itineraryId) as TrackRow | undefined;
}

export function linkTrackToItinerary(trackId: string, itineraryId: string | null) {
  getDb().prepare("UPDATE tracks SET itinerary_id = ? WHERE id = ?").run(itineraryId, trackId);
}

export function listRecentTracks(limit = 20): TrackRow[] {
  return getDb()
    .prepare("SELECT * FROM tracks ORDER BY created_at DESC LIMIT ?")
    .all(limit) as TrackRow[];
}

export function updateTrackMetrics(
  trackId: string,
  data: {
    point_count: number;
    distance_m: number;
    elev_gain_m: number;
    elev_loss_m: number;
    bbox_json: string;
    duration_sec: number | null;
    display_point_count: number;
    display_line_geojson: string;
    has_elevation: boolean;
    encoded_preview: string;
  }
) {
  getDb()
    .prepare(
      `UPDATE tracks SET
        point_count = ?, distance_m = ?, elev_gain_m = ?, elev_loss_m = ?,
        bbox_json = ?, duration_sec = ?, display_point_count = ?,
        display_line_geojson = ?, has_elevation = ?, encoded_preview = ?
       WHERE id = ?`
    )
    .run(
      data.point_count,
      data.distance_m,
      data.elev_gain_m,
      data.elev_loss_m,
      data.bbox_json,
      data.duration_sec,
      data.display_point_count,
      data.display_line_geojson,
      data.has_elevation ? 1 : 0,
      data.encoded_preview,
      trackId
    );
}
