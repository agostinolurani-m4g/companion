import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type {
  ActivityType,
  ExplorePlaceRow,
  ItineraryRow,
  MapPoiRow,
  ProfileRow,
  StopRow,
  TrackRow,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "trail-planner.db");

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  ensureStopImageUrlColumn(db);
  ensureStopWebsiteUrlColumn(db);
  seedExploreIfEmpty(db);
  ensureDefaultProfile(db);
  dbInstance = db;
  return db;
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
  db.prepare(
    `UPDATE profile SET
      display_name = ?,
      units = ?,
      sports_json = ?,
      rain_mm_h = ?,
      wind_ms = ?,
      frost_temp_c = ?,
      timezone = ?
     WHERE id = 1`
  ).run(
    p.display_name ?? cur.display_name,
    p.units ?? cur.units,
    p.sports_json ?? cur.sports_json,
    p.rain_mm_h ?? cur.rain_mm_h,
    p.wind_ms ?? cur.wind_ms,
    p.frost_temp_c ?? cur.frost_temp_c,
    p.timezone ?? cur.timezone
  );
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
    `INSERT INTO itineraries (id, name, start_date, end_date, activity, line_geojson)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.start_date ?? null,
    input.end_date ?? null,
    input.activity ?? "hiking",
    input.line_geojson ?? null
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
}): ItineraryRow {
  const db = getDb();
  if (input.id) {
    const ex = getItinerary(input.id);
    if (ex) {
      const line =
        input.line_geojson !== undefined ? input.line_geojson : ex.line_geojson;
      db.prepare(
        `UPDATE itineraries SET name = ?, start_date = ?, end_date = ?, activity = ?, line_geojson = ?
         WHERE id = ?`
      ).run(
        input.name,
        input.start_date ?? ex.start_date,
        input.end_date ?? ex.end_date,
        input.activity ?? ex.activity,
        line,
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
  getDb().prepare("UPDATE itineraries SET line_geojson = ? WHERE id = ?").run(line_geojson, id);
}

export function deleteItinerary(id: string) {
  getDb().prepare("DELETE FROM itineraries WHERE id = ?").run(id);
}

export function listStops(itineraryId: string): StopRow[] {
  return getDb()
    .prepare("SELECT * FROM stops WHERE itinerary_id = ? ORDER BY order_index ASC, name ASC")
    .all(itineraryId) as StopRow[];
}

export function listMapPois(itineraryId: string): MapPoiRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM map_pois WHERE itinerary_id = ? ORDER BY created_at DESC, name ASC"
    )
    .all(itineraryId) as MapPoiRow[];
}

export function insertMapPoi(input: {
  itinerary_id: string;
  name: string;
  lat: number;
  lng: number;
  description?: string | null;
  image_url?: string | null;
  category?: string;
  source?: string;
}): MapPoiRow {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO map_pois (id, itinerary_id, name, lat, lng, description, image_url, category, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.itinerary_id,
    input.name,
    input.lat,
    input.lng,
    input.description ?? "",
    input.image_url ?? null,
    input.category ?? "other",
    input.source ?? "chat"
  );
  return db.prepare("SELECT * FROM map_pois WHERE id = ?").get(id) as MapPoiRow;
}

export function deleteMapPoiForItinerary(poiId: string, itineraryId: string): boolean {
  const r = getDb()
    .prepare("DELETE FROM map_pois WHERE id = ? AND itinerary_id = ?")
    .run(poiId, itineraryId);
  return r.changes > 0;
}

export function getStop(id: string, itineraryId: string): StopRow | undefined {
  return getDb()
    .prepare("SELECT * FROM stops WHERE id = ? AND itinerary_id = ?")
    .get(id, itineraryId) as StopRow | undefined;
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
    segment_type?: string;
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
  const segment_type = patch.segment_type ?? ex.segment_type;
  getDb()
    .prepare(
      `UPDATE stops SET lat = ?, lng = ?, name = ?, notes = ?, image_url = ?, website_url = ?, segment_type = ?
       WHERE id = ? AND itinerary_id = ?`
    )
    .run(lat, lng, name, notes, image_url, website_url, segment_type, id, itineraryId);
  return getStop(id, itineraryId) ?? null;
}

export function deleteStop(id: string, itineraryId: string): boolean {
  const r = getDb()
    .prepare("DELETE FROM stops WHERE id = ? AND itinerary_id = ?")
    .run(id, itineraryId);
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
}): StopRow {
  const db = getDb();
  const id = uuidv4();
  const max = db
    .prepare("SELECT COALESCE(MAX(order_index), -1) as m FROM stops WHERE itinerary_id = ?")
    .get(input.itinerary_id) as { m: number };
  const order_index = input.order_index ?? max.m + 1;
  db.prepare(
    `INSERT INTO stops (id, itinerary_id, segment_type, name, order_index, lat, lng, notes, image_url, website_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.itinerary_id,
    input.segment_type,
    input.name,
    order_index,
    input.lat,
    input.lng,
    input.notes ?? null,
    input.image_url ?? null,
    input.website_url ?? null
  );
  return db.prepare("SELECT * FROM stops WHERE id = ?").get(id) as StopRow;
}

/** Inserisce una tappa a `insertionOrder` e incrementa `order_index` delle tappe già ≥ quel valore. */
export function addStopAtOrder(
  input: Omit<Parameters<typeof addStop>[0], "order_index">,
  insertionOrder: number
): StopRow {
  const db = getDb();
  const tid = input.itinerary_id;
  return db.transaction(() => {
    db.prepare(
      `UPDATE stops SET order_index = order_index + 1 WHERE itinerary_id = ? AND order_index >= ?`
    ).run(tid, insertionOrder);
    return addStop({ ...input, order_index: insertionOrder });
  })();
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
  }>
) {
  const db = getDb();
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
    });
  });
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

export function listExplorePlaces(): ExplorePlaceRow[] {
  return getDb().prepare("SELECT * FROM explore_places ORDER BY name ASC").all() as ExplorePlaceRow[];
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
