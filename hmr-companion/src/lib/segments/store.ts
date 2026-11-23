import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { lineBbox, parseActivityLine, type ActivityRow } from "@/lib/activities/store";
import { matchSegment, segmentStats, type SegmentStats } from "./match";

/**
 * Segmenti (stile Strava): tratti di traccia con classifica dei passaggi.
 *
 * Visibilità dei tempi (accordo API Strava: i dati di un atleta solo a lui):
 * - le prestazioni da attività Strava le vede solo il proprietario (PR personali);
 * - in classifica pubblica entrano i passaggi da file/app con consenso community.
 */

export type SegmentVisibility = "public" | "private";

export type SegmentRow = {
  id: string;
  owner: string;
  name: string;
  sport: string;
  geojson: string;
  length_m: number;
  elev_gain_m: number;
  avg_grade_pct: number;
  max_grade_pct: number;
  min_ele: number | null;
  max_ele: number | null;
  bbox_w: number;
  bbox_s: number;
  bbox_e: number;
  bbox_n: number;
  visibility: SegmentVisibility;
  source_kind: string | null;
  source_id: string | null;
  created_at: number;
};

export type SegmentEffortRow = {
  id: string;
  segment_id: string;
  activity_id: string;
  owner: string;
  provider: string;
  public_ok: number;
  start_time: number;
  elapsed_s: number | null;
  distance_m: number;
  created_at: number;
};

export function migrateSegmentsStore(db: Database.Database): void {
  const actCols = new Set(
    (db.prepare(`PRAGMA table_info(activities)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (actCols.size && !actCols.has("times_json")) {
    db.exec(`ALTER TABLE activities ADD COLUMN times_json TEXT`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      sport TEXT NOT NULL,
      geojson TEXT NOT NULL,
      length_m REAL NOT NULL,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      avg_grade_pct REAL NOT NULL DEFAULT 0,
      max_grade_pct REAL NOT NULL DEFAULT 0,
      min_ele REAL,
      max_ele REAL,
      bbox_w REAL NOT NULL,
      bbox_s REAL NOT NULL,
      bbox_e REAL NOT NULL,
      bbox_n REAL NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
      source_kind TEXT,
      source_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_segments_bbox ON segments(bbox_w, bbox_e, bbox_s, bbox_n);
    CREATE INDEX IF NOT EXISTS idx_segments_owner ON segments(owner, created_at DESC);

    CREATE TABLE IF NOT EXISTS segment_efforts (
      id TEXT PRIMARY KEY,
      segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      provider TEXT NOT NULL,
      public_ok INTEGER NOT NULL DEFAULT 0,
      start_time INTEGER NOT NULL,
      elapsed_s INTEGER,
      distance_m REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(segment_id, activity_id, start_time)
    );
    CREATE INDEX IF NOT EXISTS idx_segment_efforts_seg ON segment_efforts(segment_id, elapsed_s);
    CREATE INDEX IF NOT EXISTS idx_segment_efforts_owner ON segment_efforts(owner, segment_id);
    CREATE INDEX IF NOT EXISTS idx_segment_efforts_activity ON segment_efforts(activity_id);
  `);
}

export function parseActivityTimes(row: { times_json?: string | null }): number[] | null {
  if (!row.times_json) return null;
  try {
    const t = JSON.parse(row.times_json) as unknown;
    return Array.isArray(t) && t.every((x) => typeof x === "number") ? (t as number[]) : null;
  } catch {
    return null;
  }
}

export function setActivityTrack(
  db: Database.Database,
  id: string,
  line: GeoJSON.LineString,
  times: number[] | null,
): void {
  const [w, s, e, n] = lineBbox(line);
  db.prepare(
    `UPDATE activities SET geojson = ?, times_json = ?, bbox_w = ?, bbox_s = ?, bbox_e = ?, bbox_n = ? WHERE id = ?`,
  ).run(JSON.stringify(line), times ? JSON.stringify(times) : null, w, s, e, n, id);
}

export function setActivityTimes(db: Database.Database, id: string, times: number[] | null): void {
  db.prepare(`UPDATE activities SET times_json = ? WHERE id = ?`).run(times ? JSON.stringify(times) : null, id);
}

// ---------------------------------------------------------------------------
// segments
// ---------------------------------------------------------------------------

export type NewSegment = {
  owner: string;
  name: string;
  sport: string;
  coords: GeoJSON.Position[];
  visibility: SegmentVisibility;
  source_kind?: string | null;
  source_id?: string | null;
  now: number;
};

export function insertSegment(db: Database.Database, input: NewSegment): SegmentRow {
  const line: GeoJSON.LineString = { type: "LineString", coordinates: input.coords };
  const st: SegmentStats = segmentStats(input.coords);
  const [w, s, e, n] = lineBbox(line);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO segments
       (id, owner, name, sport, geojson, length_m, elev_gain_m, avg_grade_pct, max_grade_pct, min_ele, max_ele,
        bbox_w, bbox_s, bbox_e, bbox_n, visibility, source_kind, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.owner,
    input.name,
    input.sport,
    JSON.stringify(line),
    st.length_m,
    st.elev_gain_m,
    st.avg_grade_pct,
    st.max_grade_pct,
    st.min_ele,
    st.max_ele,
    w,
    s,
    e,
    n,
    input.visibility,
    input.source_kind ?? null,
    input.source_id ?? null,
    input.now,
  );
  return getSegment(db, id)!;
}

export function getSegment(db: Database.Database, id: string): SegmentRow | undefined {
  return db.prepare(`SELECT * FROM segments WHERE id = ?`).get(id) as SegmentRow | undefined;
}

export function canViewSegment(seg: SegmentRow, viewer: string): boolean {
  return seg.visibility === "public" || seg.owner === viewer;
}

export function deleteSegment(db: Database.Database, id: string): boolean {
  db.prepare(`DELETE FROM segment_efforts WHERE segment_id = ?`).run(id);
  return db.prepare(`DELETE FROM segments WHERE id = ?`).run(id).changes > 0;
}

export function listSegmentsInBbox(
  db: Database.Database,
  viewer: string,
  bbox: { west: number; south: number; east: number; north: number },
  opts: { sport?: string; limit?: number } = {},
): SegmentRow[] {
  const args: unknown[] = [bbox.west, bbox.east, bbox.south, bbox.north, viewer];
  let sql = `SELECT * FROM segments
     WHERE bbox_e >= ? AND bbox_w <= ? AND bbox_n >= ? AND bbox_s <= ?
       AND (visibility = 'public' OR owner = ?)`;
  if (opts.sport) {
    sql += ` AND sport = ?`;
    args.push(opts.sport);
  }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(opts.limit ?? 200, 1), 500));
  return db.prepare(sql).all(...args) as SegmentRow[];
}

/** Segmenti su cui l'utente ha almeno un passaggio, o creati da lui. */
export function listSegmentsForUser(db: Database.Database, viewer: string, limit = 100): SegmentRow[] {
  return db
    .prepare(
      `SELECT s.* FROM segments s
       WHERE (s.owner = ? OR s.id IN (SELECT segment_id FROM segment_efforts WHERE owner = ?))
         AND (s.visibility = 'public' OR s.owner = ?)
       ORDER BY s.created_at DESC LIMIT ?`,
    )
    .all(viewer, viewer, viewer, limit) as SegmentRow[];
}

// ---------------------------------------------------------------------------
// efforts
// ---------------------------------------------------------------------------

function effortPublicOk(act: Pick<ActivityRow, "provider" | "community_consent">): boolean {
  return act.provider !== "strava" && act.community_consent === 1;
}

/** Ricalcola i passaggi di un'attività su un segmento (idempotente). Restituisce quanti. */
export function matchActivityOnSegment(
  db: Database.Database,
  seg: Pick<SegmentRow, "id" | "geojson">,
  act: ActivityRow & { times_json?: string | null },
  now: number,
): number {
  const segLine = JSON.parse(seg.geojson) as GeoJSON.LineString;
  const line = parseActivityLine(act);
  const matches = matchSegment(segLine.coordinates, line.coordinates, parseActivityTimes(act));
  db.prepare(`DELETE FROM segment_efforts WHERE segment_id = ? AND activity_id = ?`).run(seg.id, act.id);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO segment_efforts
       (id, segment_id, activity_id, owner, provider, public_ok, start_time, elapsed_s, distance_m, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const m of matches) {
    ins.run(
      crypto.randomUUID(),
      seg.id,
      act.id,
      act.owner,
      act.provider,
      effortPublicOk(act) ? 1 : 0,
      act.start_time + (m.start_offset_s != null ? m.start_offset_s * 1000 : Math.round(m.start_f)),
      m.elapsed_s,
      m.distance_m,
      now,
    );
  }
  return matches.length;
}

type ActivityWithTimes = ActivityRow & { times_json?: string | null };

function activitiesInBbox(db: Database.Database, seg: SegmentRow): ActivityWithTimes[] {
  return db
    .prepare(
      `SELECT * FROM activities
       WHERE bbox_w <= ? AND bbox_e >= ? AND bbox_s <= ? AND bbox_n >= ?`,
    )
    .all(seg.bbox_w, seg.bbox_e, seg.bbox_s, seg.bbox_n) as ActivityWithTimes[];
}

/** Cerca i passaggi di tutte le attività (di tutti) che contengono il segmento. */
export function matchSegmentAgainstActivities(db: Database.Database, seg: SegmentRow, now: number): number {
  let n = 0;
  const tx = db.transaction(() => {
    for (const act of activitiesInBbox(db, seg)) n += matchActivityOnSegment(db, seg, act, now);
  });
  tx();
  return n;
}

/** Dopo l'import di un'attività: passaggi su tutti i segmenti che attraversa. */
export function matchActivityAgainstSegments(db: Database.Database, act: ActivityWithTimes, now: number): number {
  const segs = db
    .prepare(
      `SELECT id, geojson FROM segments
       WHERE bbox_w >= ? AND bbox_e <= ? AND bbox_s >= ? AND bbox_n <= ?`,
    )
    .all(act.bbox_w - 0.001, act.bbox_e + 0.001, act.bbox_s - 0.001, act.bbox_n + 0.001) as Pick<
    SegmentRow,
    "id" | "geojson"
  >[];
  let n = 0;
  for (const s of segs) n += matchActivityOnSegment(db, s, act, now);
  return n;
}

export function deleteEffortsForActivity(db: Database.Database, activityId: string): void {
  db.prepare(`DELETE FROM segment_efforts WHERE activity_id = ?`).run(activityId);
}

/** Attività Strava del viewer che contengono l'area del segmento ma senza orari (da completare con gli stream). */
export function stravaActivitiesMissingTimes(
  db: Database.Database,
  seg: SegmentRow,
  owner: string,
  limit: number,
): ActivityWithTimes[] {
  return db
    .prepare(
      `SELECT * FROM activities
       WHERE owner = ? AND provider = 'strava' AND times_json IS NULL
         AND bbox_w <= ? AND bbox_e >= ? AND bbox_s <= ? AND bbox_n >= ?
       ORDER BY start_time DESC LIMIT ?`,
    )
    .all(owner, seg.bbox_w + 0.002, seg.bbox_e - 0.002, seg.bbox_s + 0.002, seg.bbox_n - 0.002, limit) as ActivityWithTimes[];
}

// ---------------------------------------------------------------------------
// classifiche
// ---------------------------------------------------------------------------

export type LeaderboardEntry = { owner: string; elapsed_s: number; start_time: number; activity_id: string; rank: number };
export type LegendEntry = { owner: string; efforts: number; rank: number };

const VISIBLE = `(e.public_ok = 1 OR e.owner = @viewer)`;

/** Miglior tempo per persona (periodo opzionale). */
export function segmentLeaderboard(
  db: Database.Database,
  segmentId: string,
  viewer: string,
  opts: { since?: number; limit?: number } = {},
): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT e.owner, MIN(e.elapsed_s) AS elapsed_s FROM segment_efforts e
       WHERE e.segment_id = @seg AND e.elapsed_s IS NOT NULL AND ${VISIBLE} AND e.start_time >= @since
       GROUP BY e.owner ORDER BY elapsed_s ASC LIMIT @limit`,
    )
    .all({ seg: segmentId, viewer, since: opts.since ?? 0, limit: opts.limit ?? 50 }) as {
    owner: string;
    elapsed_s: number;
  }[];
  const pick = db.prepare(
    `SELECT activity_id, start_time FROM segment_efforts e
     WHERE e.segment_id = @seg AND e.owner = @owner AND e.elapsed_s = @elapsed AND ${VISIBLE} AND e.start_time >= @since
     ORDER BY start_time ASC LIMIT 1`,
  );
  return rows.map((r, i) => {
    const p = pick.get({ seg: segmentId, owner: r.owner, elapsed: r.elapsed_s, viewer, since: opts.since ?? 0 }) as {
      activity_id: string;
      start_time: number;
    };
    return { owner: r.owner, elapsed_s: r.elapsed_s, start_time: p.start_time, activity_id: p.activity_id, rank: i + 1 };
  });
}

export const LEGEND_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** "Local Legend": chi ci è passato più volte negli ultimi 90 giorni (premia la costanza, non la velocità). */
export function segmentLegends(
  db: Database.Database,
  segmentId: string,
  viewer: string,
  now: number,
  limit = 20,
): LegendEntry[] {
  const rows = db
    .prepare(
      `SELECT e.owner, COUNT(*) AS efforts, MAX(e.start_time) AS last FROM segment_efforts e
       WHERE e.segment_id = @seg AND ${VISIBLE} AND e.start_time >= @since
       GROUP BY e.owner ORDER BY efforts DESC, last DESC LIMIT @limit`,
    )
    .all({ seg: segmentId, viewer, since: now - LEGEND_WINDOW_MS, limit }) as { owner: string; efforts: number }[];
  return rows.map((r, i) => ({ owner: r.owner, efforts: r.efforts, rank: i + 1 }));
}

export type MyEffort = {
  id: string;
  activity_id: string;
  activity_name: string;
  provider: string;
  start_time: number;
  elapsed_s: number | null;
  distance_m: number;
};

export function myEfforts(db: Database.Database, segmentId: string, viewer: string, limit = 100): MyEffort[] {
  return db
    .prepare(
      `SELECT e.id, e.activity_id, COALESCE(a.name, '') AS activity_name, e.provider, e.start_time, e.elapsed_s, e.distance_m
       FROM segment_efforts e LEFT JOIN activities a ON a.id = e.activity_id
       WHERE e.segment_id = ? AND e.owner = ?
       ORDER BY e.start_time DESC LIMIT ?`,
    )
    .all(segmentId, viewer, limit) as MyEffort[];
}

export function segmentEffortCounts(
  db: Database.Database,
  segmentId: string,
  viewer: string,
): { efforts: number; athletes: number } {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS efforts, COUNT(DISTINCT owner) AS athletes FROM segment_efforts e
       WHERE e.segment_id = @seg AND ${VISIBLE}`,
    )
    .get({ seg: segmentId, viewer }) as { efforts: number; athletes: number };
  return r;
}
