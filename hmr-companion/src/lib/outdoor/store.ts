import type Database from "better-sqlite3";
import type { UserRouteActivity } from "@/lib/sports";
import type { OutdoorGroup } from "./groups";
import { kindRelevantForSport, kindVisibleAtZoom } from "./kinds";
import type { OsmElementType } from "./taxonomy";
import { outdoorFeatureId } from "./taxonomy";

export type OutdoorFeatureRow = {
  id: string;
  osm_type: string;
  osm_id: number;
  grp: string;
  kind: string;
  name: string;
  lat: number;
  lng: number;
  ele: number | null;
  ele_source?: string | null;
  tags_json: string;
  geom_json: string | null;
  source: string;
  updated_at: number;
};

export type DestinationSignRow = {
  feature_id: string;
  destination: string;
  distance_m: number | null;
  duration_s: number | null;
  color: string | null;
  sort_order: number;
};

export type FeatureLinkRow = {
  feature_id: string;
  source: string;
  external_id: string;
  payload_json: string;
  fetched_at: number;
};

export function migrateOutdoorStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS outdoor_features (
      id TEXT PRIMARY KEY,
      osm_type TEXT NOT NULL,
      osm_id INTEGER NOT NULL,
      grp TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      ele REAL,
      tags_json TEXT NOT NULL DEFAULT '{}',
      geom_json TEXT,
      source TEXT NOT NULL DEFAULT 'osm',
      updated_at INTEGER NOT NULL,
      UNIQUE(osm_type, osm_id)
    );
    CREATE INDEX IF NOT EXISTS idx_outdoor_features_kind ON outdoor_features(kind);
    CREATE INDEX IF NOT EXISTS idx_outdoor_features_grp ON outdoor_features(grp);

    CREATE VIRTUAL TABLE IF NOT EXISTS outdoor_features_fts USING fts5(
      feature_id UNINDEXED,
      name,
      ref,
      kind
    );

    CREATE TABLE IF NOT EXISTS outdoor_features_rtree (
      id INTEGER PRIMARY KEY,
      minLat REAL NOT NULL,
      maxLat REAL NOT NULL,
      minLng REAL NOT NULL,
      maxLng REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS destination_signs (
      feature_id TEXT NOT NULL REFERENCES outdoor_features(id) ON DELETE CASCADE,
      destination TEXT NOT NULL,
      distance_m REAL,
      duration_s REAL,
      color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (feature_id, destination, sort_order)
    );

    CREATE TABLE IF NOT EXISTS outdoor_tiles (
      z INTEGER NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      source TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (z, x, y)
    );

    CREATE TABLE IF NOT EXISTS feature_links (
      feature_id TEXT NOT NULL REFERENCES outdoor_features(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (feature_id, source, external_id)
    );

    CREATE TABLE IF NOT EXISTS outdoor_import_nodes (
      node_id INTEGER PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );
  `);

  const ftsRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'outdoor_features_fts'`)
    .get() as { sql: string } | undefined;
  if (ftsRow?.sql?.includes("contentless")) {
    db.exec(`DROP TABLE IF EXISTS outdoor_features_fts`);
    db.exec(`
      CREATE VIRTUAL TABLE outdoor_features_fts USING fts5(
        feature_id UNINDEXED,
        name,
        ref,
        kind
      );
    `);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS outdoor_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  // Origine della quota: 'osm' (tag ele), 'dem' (backfill), 'refuges.info'.
  const cols = db.prepare(`PRAGMA table_info(outdoor_features)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "ele_source")) {
    db.exec(`ALTER TABLE outdoor_features ADD COLUMN ele_source TEXT`);
    db.exec(`UPDATE outdoor_features SET ele_source = 'osm' WHERE ele IS NOT NULL`);
  }

  // outdoor_features_rtree era una tabella normale (scan completo a ogni bbox): diventa un vero R*Tree.
  const rtreeRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE name = 'outdoor_features_rtree'`)
    .get() as { sql: string } | undefined;
  if (rtreeRow && !/using\s+rtree/i.test(rtreeRow.sql)) {
    db.transaction(() => {
      db.exec(`ALTER TABLE outdoor_features_rtree RENAME TO outdoor_features_rtree_old`);
      db.exec(
        `CREATE VIRTUAL TABLE outdoor_features_rtree USING rtree(id, minLat, maxLat, minLng, maxLng)`,
      );
      db.exec(
        `INSERT INTO outdoor_features_rtree (id, minLat, maxLat, minLng, maxLng)
         SELECT id, minLat, maxLat, minLng, maxLng FROM outdoor_features_rtree_old`,
      );
      db.exec(`DROP TABLE outdoor_features_rtree_old`);
    })();
  }

  // FTS allineato per rowid a outdoor_features: delete/insert O(log n) invece di uno scan per riga.
  const aligned = db.prepare(`SELECT value FROM outdoor_meta WHERE key = 'fts_rowid_aligned'`).get() as
    | { value: string }
    | undefined;
  if (!aligned) {
    rebuildOutdoorFts(db);
    db.prepare(`INSERT OR REPLACE INTO outdoor_meta (key, value) VALUES ('fts_rowid_aligned', '1')`).run();
  }
}

/** Ricostruisce l'indice FTS da outdoor_features (rowid FTS = rowid feature). */
export function rebuildOutdoorFts(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`DELETE FROM outdoor_features_fts`);
    db.exec(`
      INSERT INTO outdoor_features_fts (rowid, feature_id, name, ref, kind)
      SELECT rowid, id, name,
        COALESCE(
          NULLIF(TRIM(json_extract(tags_json, '$.ref')), ''),
          NULLIF(TRIM(json_extract(tags_json, '$."ref:CAI"')), ''),
          NULLIF(TRIM(json_extract(tags_json, '$."ref:REI"')), ''),
          ''
        ),
        kind
      FROM outdoor_features
    `);
  })();
}

export function outdoorFeatureCount(db: Database.Database): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM outdoor_features`).get() as { n: number };
  return r.n;
}

const STMT_CACHE = new WeakMap<Database.Database, Map<string, Database.Statement>>();

/** prepare() con cache per connessione: l'upsert è chiamato centinaia di migliaia di volte nell'import. */
function st(db: Database.Database, sql: string): Database.Statement {
  let m = STMT_CACHE.get(db);
  if (!m) {
    m = new Map();
    STMT_CACHE.set(db, m);
  }
  let s = m.get(sql);
  if (!s) {
    s = db.prepare(sql);
    m.set(sql, s);
  }
  return s;
}

function ftsUpsert(
  db: Database.Database,
  rowid: number,
  featureId: string,
  name: string,
  ref: string,
  kind: string,
): void {
  st(db, `DELETE FROM outdoor_features_fts WHERE rowid = ?`).run(rowid);
  st(db, `INSERT INTO outdoor_features_fts(rowid, feature_id, name, ref, kind) VALUES (?, ?, ?, ?, ?)`).run(
    rowid,
    featureId,
    name,
    ref,
    kind,
  );
}

export type UpsertOutdoorFeatureInput = {
  osmType: OsmElementType;
  osmId: number;
  grp: OutdoorGroup | string;
  kind: string;
  name: string;
  lat: number;
  lng: number;
  ele?: number | null;
  /** Origine di `ele` (default 'osm' se ele è valorizzata). */
  eleSource?: string | null;
  tags: Record<string, string>;
  geomJson?: string | null;
  source?: string;
  updatedAt?: number;
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

/**
 * Inserisce o aggiorna una feature. Se `ele` in input è nulla, una quota già calcolata
 * dal DEM (ele_source='dem') viene mantenuta, così il re-import non annulla il backfill.
 */
export function upsertOutdoorFeature(db: Database.Database, input: UpsertOutdoorFeatureInput): void {
  const id = outdoorFeatureId(input.osmType, input.osmId);
  const updatedAt = input.updatedAt ?? Math.floor(Date.now() / 1000);
  const tagsJson = JSON.stringify(input.tags);
  const minLat = input.bbox?.minLat ?? input.lat;
  const maxLat = input.bbox?.maxLat ?? input.lat;
  const minLng = input.bbox?.minLng ?? input.lng;
  const maxLng = input.bbox?.maxLng ?? input.lng;

  const existing = st(db, `SELECT rowid FROM outdoor_features WHERE id = ?`).get(id) as
    | { rowid: number }
    | undefined;

  const ele = input.ele ?? null;
  const eleSource = ele != null ? (input.eleSource ?? "osm") : null;
  let rowid: number;

  if (existing) {
    rowid = existing.rowid;
    st(
      db,
      `UPDATE outdoor_features SET
        grp = ?, kind = ?, name = ?, lat = ?, lng = ?,
        ele = CASE WHEN ? IS NOT NULL THEN ? WHEN ele_source = 'dem' THEN ele ELSE NULL END,
        ele_source = CASE WHEN ? IS NOT NULL THEN ? WHEN ele_source = 'dem' THEN 'dem' ELSE NULL END,
        tags_json = ?, geom_json = ?, source = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.grp,
      input.kind,
      input.name,
      input.lat,
      input.lng,
      ele,
      ele,
      ele,
      eleSource,
      tagsJson,
      input.geomJson ?? null,
      input.source ?? "osm",
      updatedAt,
      id,
    );
    st(
      db,
      `UPDATE outdoor_features_rtree SET minLat = ?, maxLat = ?, minLng = ?, maxLng = ? WHERE id = ?`,
    ).run(minLat, maxLat, minLng, maxLng, rowid);
  } else {
    const info = st(
      db,
        `INSERT INTO outdoor_features
          (id, osm_type, osm_id, grp, kind, name, lat, lng, ele, ele_source, tags_json, geom_json, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.osmType,
        input.osmId,
        input.grp,
        input.kind,
        input.name,
        input.lat,
        input.lng,
        ele,
        eleSource,
        tagsJson,
        input.geomJson ?? null,
        input.source ?? "osm",
        updatedAt,
      );
    rowid = Number(info.lastInsertRowid);
    st(
      db,
      `INSERT INTO outdoor_features_rtree (id, minLat, maxLat, minLng, maxLng) VALUES (?, ?, ?, ?, ?)`,
    ).run(rowid, minLat, maxLat, minLng, maxLng);
  }

  const ref =
    input.tags.ref?.trim() ||
    input.tags["ref:CAI"]?.trim() ||
    input.tags["ref:REI"]?.trim() ||
    "";
  ftsUpsert(db, rowid, id, input.name, ref, input.kind);
}

/** Elimina una feature con le righe collegate (rtree, FTS, link, cartelli). */
export function deleteOutdoorFeature(db: Database.Database, id: string): boolean {
  const row = db.prepare(`SELECT rowid FROM outdoor_features WHERE id = ?`).get(id) as { rowid: number } | undefined;
  if (!row) return false;
  db.prepare(`DELETE FROM outdoor_features_rtree WHERE id = ?`).run(row.rowid);
  db.prepare(`DELETE FROM outdoor_features_fts WHERE rowid = ?`).run(row.rowid);
  db.prepare(`DELETE FROM feature_links WHERE feature_id = ?`).run(id);
  db.prepare(`DELETE FROM destination_signs WHERE feature_id = ?`).run(id);
  db.prepare(`DELETE FROM outdoor_features WHERE id = ?`).run(id);
  return true;
}

/** Imposta la quota calcolata dal DEM solo dove manca (idempotente). */
export function setDemElevation(db: Database.Database, id: string, ele: number): boolean {
  const r = db
    .prepare(`UPDATE outdoor_features SET ele = ?, ele_source = 'dem' WHERE id = ? AND ele IS NULL`)
    .run(ele, id);
  return r.changes > 0;
}

export function upsertOutdoorFeatureBatch(db: Database.Database, rows: UpsertOutdoorFeatureInput[]): void {
  if (rows.length === 0) return;
  const tx = db.transaction(() => {
    for (const r of rows) upsertOutdoorFeature(db, r);
  });
  tx();
}

export function replaceDestinationSigns(
  db: Database.Database,
  featureId: string,
  signs: Omit<DestinationSignRow, "feature_id">[],
): void {
  db.prepare(`DELETE FROM destination_signs WHERE feature_id = ?`).run(featureId);
  const ins = db.prepare(
    `INSERT INTO destination_signs (feature_id, destination, distance_m, duration_s, color, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const s of signs) {
    ins.run(featureId, s.destination, s.distance_m, s.duration_s, s.color, s.sort_order);
  }
}

export function getOutdoorFeatureById(db: Database.Database, id: string): OutdoorFeatureRow | undefined {
  return db.prepare(`SELECT * FROM outdoor_features WHERE id = ?`).get(id) as OutdoorFeatureRow | undefined;
}

export function getDestinationSigns(db: Database.Database, featureId: string): DestinationSignRow[] {
  return db
    .prepare(`SELECT * FROM destination_signs WHERE feature_id = ? ORDER BY sort_order`)
    .all(featureId) as DestinationSignRow[];
}

export function getFeatureLinks(db: Database.Database, featureId: string): FeatureLinkRow[] {
  return db
    .prepare(`SELECT * FROM feature_links WHERE feature_id = ? ORDER BY fetched_at DESC`)
    .all(featureId) as FeatureLinkRow[];
}

export function upsertFeatureLink(
  db: Database.Database,
  featureId: string,
  source: string,
  externalId: string,
  payload: unknown,
  fetchedAt?: number,
): void {
  db.prepare(
    `INSERT INTO feature_links (feature_id, source, external_id, payload_json, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(feature_id, source, external_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       fetched_at = excluded.fetched_at`,
  ).run(featureId, source, externalId, JSON.stringify(payload), fetchedAt ?? Math.floor(Date.now() / 1000));
}

export type OutdoorQueryOptions = {
  south: number;
  west: number;
  north: number;
  east: number;
  zoom: number;
  sport?: UserRouteActivity | null;
  groups?: OutdoorGroup[] | null;
  kinds?: string[] | null;
  limit?: number;
};

export function queryOutdoorFeaturesInBbox(
  db: Database.Database,
  opts: OutdoorQueryOptions,
): OutdoorFeatureRow[] {
  const limit = opts.limit ?? 8000;
  const groupClause =
    opts.groups && opts.groups.length > 0
      ? ` AND p.grp IN (${opts.groups.map(() => "?").join(",")})`
      : "";
  const kindClause =
    opts.kinds && opts.kinds.length > 0 ? ` AND p.kind IN (${opts.kinds.map(() => "?").join(",")})` : "";

  const sql = `SELECT p.* FROM outdoor_features p
    INNER JOIN outdoor_features_rtree r ON r.id = p.rowid
    WHERE r.maxLat >= ? AND r.minLat <= ?
      AND r.maxLng >= ? AND r.minLng <= ?${groupClause}${kindClause}
    LIMIT ?`;

  const params: (number | string)[] = [
    opts.south,
    opts.north,
    opts.west,
    opts.east,
    ...(opts.groups ?? []),
    ...(opts.kinds ?? []),
    limit,
  ];

  let rows = db.prepare(sql).all(...params) as OutdoorFeatureRow[];
  rows = rows.filter((row) => {
    if (!kindVisibleAtZoom(row.kind, opts.zoom)) return false;
    if (opts.sport && !kindRelevantForSport(row.kind, opts.sport)) return false;
    return true;
  });
  return rows;
}

export function countOutdoorByGroupInBbox(
  db: Database.Database,
  south: number,
  west: number,
  north: number,
  east: number,
  zoom: number,
  sport?: UserRouteActivity | null,
): Array<{ grp: string; n: number }> {
  const sql = `SELECT p.grp, p.kind, COUNT(*) AS n FROM outdoor_features p
    INNER JOIN outdoor_features_rtree r ON r.id = p.rowid
    WHERE r.maxLat >= ? AND r.minLat <= ?
      AND r.maxLng >= ? AND r.minLng <= ?
    GROUP BY p.grp, p.kind`;
  const raw = db.prepare(sql).all(south, north, west, east) as Array<{ grp: string; kind: string; n: number }>;
  const byGrp = new Map<string, number>();
  for (const row of raw) {
    if (!kindVisibleAtZoom(row.kind, zoom)) continue;
    if (sport && !kindRelevantForSport(row.kind, sport)) continue;
    byGrp.set(row.grp, (byGrp.get(row.grp) ?? 0) + row.n);
  }
  return [...byGrp.entries()].map(([grp, n]) => ({ grp, n })).sort((a, b) => b.n - a.n);
}

export function searchOutdoorFeatures(
  db: Database.Database,
  q: string,
  limit = 25,
): Array<{ feature_id: string; name: string; kind: string; rank: number }> {
  const term = q.trim();
  if (term.length < 2) return [];
  const match = `${term}*`;
  let rows = db
    .prepare(
      `SELECT feature_id, name, kind, bm25(outdoor_features_fts) AS rank
       FROM outdoor_features_fts
       WHERE outdoor_features_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(match, limit) as Array<{ feature_id: string; name: string; kind: string; rank: number }>;

  if (rows.length === 0) {
    rows = db
      .prepare(
        `SELECT id AS feature_id, name, kind, 0 AS rank
         FROM outdoor_features
         WHERE name LIKE ? COLLATE NOCASE OR tags_json LIKE ? COLLATE NOCASE
         LIMIT ?`,
      )
      .all(`%${term}%`, `%${term}%`, limit) as Array<{
      feature_id: string;
      name: string;
      kind: string;
      rank: number;
    }>;
  }
  return rows;
}

export function outdoorTileExists(db: Database.Database, z: number, x: number, y: number): boolean {
  const r = db.prepare(`SELECT 1 FROM outdoor_tiles WHERE z = ? AND x = ? AND y = ?`).get(z, x, y);
  return Boolean(r);
}

export function markOutdoorTile(
  db: Database.Database,
  z: number,
  x: number,
  y: number,
  source: string,
  updatedAt?: number,
): void {
  db.prepare(
    `INSERT INTO outdoor_tiles (z, x, y, source, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(z, x, y) DO UPDATE SET source = excluded.source, updated_at = excluded.updated_at`,
  ).run(z, x, y, source, updatedAt ?? Math.floor(Date.now() / 1000));
}

export function missingOutdoorTilesZ10(
  db: Database.Database,
  tiles: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  const check = db.prepare(`SELECT 1 FROM outdoor_tiles WHERE z = 10 AND x = ? AND y = ?`);
  return tiles.filter((t) => !check.get(t.x, t.y));
}

/** Nodi temporanei per import PBF (legacy: l'import attuale tiene i nodi in memoria). */
export function clearImportNodes(db: Database.Database): void {
  db.exec(`DELETE FROM outdoor_import_nodes`);
}

export function insertImportNodeBatch(db: Database.Database, nodes: Array<{ id: number; lat: number; lng: number }>): void {
  if (nodes.length === 0) return;
  const ins = db.prepare(`INSERT OR REPLACE INTO outdoor_import_nodes (node_id, lat, lng) VALUES (?, ?, ?)`);
  const tx = db.transaction(() => {
    for (const n of nodes) ins.run(n.id, n.lat, n.lng);
  });
  tx();
}

export function getImportNode(db: Database.Database, nodeId: number): { lat: number; lng: number } | undefined {
  return db.prepare(`SELECT lat, lng FROM outdoor_import_nodes WHERE node_id = ?`).get(nodeId) as
    | { lat: number; lng: number }
    | undefined;
}
