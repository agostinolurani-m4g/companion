import crypto from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Highlights della community (stile Komoot): punti consigliati con consiglio,
 * foto e "consigliato da" N persone. Proposti in pianificazione lungo il percorso.
 */

export type HighlightRow = {
  id: string;
  owner: string;
  name: string;
  tip: string;
  /** Sport per cui vale ("" = tutti). */
  sport: string;
  lat: number;
  lng: number;
  photo_id: string | null;
  created_at: number;
  updated_at: number;
};

export type HighlightWithVotes = HighlightRow & { votes: number; voted: number };

export function migrateHighlights(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      tip TEXT NOT NULL DEFAULT '',
      sport TEXT NOT NULL DEFAULT '',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      photo_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_highlights_latlng ON highlights(lat, lng);
    CREATE TABLE IF NOT EXISTS highlight_votes (
      highlight_id TEXT NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (highlight_id, username)
    );
  `);
}

export type NewHighlight = {
  owner: string;
  name: string;
  tip: string;
  sport: string;
  lat: number;
  lng: number;
  photo_id?: string | null;
  now: number;
};

/** Crea l'highlight; chi lo crea lo consiglia già (conta come primo voto). */
export function insertHighlight(db: Database.Database, h: NewHighlight): HighlightWithVotes {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO highlights (id, owner, name, tip, sport, lat, lng, photo_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, h.owner, h.name, h.tip, h.sport, h.lat, h.lng, h.photo_id ?? null, h.now, h.now);
  db.prepare(`INSERT INTO highlight_votes (highlight_id, username, created_at) VALUES (?, ?, ?)`).run(id, h.owner, h.now);
  return getHighlight(db, id, h.owner)!;
}

const WITH_VOTES = `
  SELECT h.*,
    (SELECT COUNT(*) FROM highlight_votes v WHERE v.highlight_id = h.id) AS votes,
    EXISTS(SELECT 1 FROM highlight_votes v WHERE v.highlight_id = h.id AND v.username = @viewer) AS voted
  FROM highlights h`;

export function getHighlight(db: Database.Database, id: string, viewer: string): HighlightWithVotes | undefined {
  return db.prepare(`${WITH_VOTES} WHERE h.id = @id`).get({ id, viewer }) as HighlightWithVotes | undefined;
}

export function listHighlightsInBbox(
  db: Database.Database,
  viewer: string,
  bbox: { south: number; west: number; north: number; east: number },
  opts: { sport?: string; limit?: number } = {},
): HighlightWithVotes[] {
  const sportSql = opts.sport ? ` AND (h.sport = '' OR h.sport = @sport)` : "";
  return db
    .prepare(
      `${WITH_VOTES}
       WHERE h.lat BETWEEN @south AND @north AND h.lng BETWEEN @west AND @east${sportSql}
       ORDER BY votes DESC, h.created_at DESC LIMIT @limit`,
    )
    .all({ ...bbox, viewer, limit: Math.min(Math.max(opts.limit ?? 300, 1), 1000), ...(opts.sport ? { sport: opts.sport } : {}) }) as HighlightWithVotes[];
}

/** Consiglia / togli il consiglio. Restituisce lo stato aggiornato. */
export function toggleHighlightVote(db: Database.Database, id: string, username: string, now: number): HighlightWithVotes | undefined {
  const had = db.prepare(`SELECT 1 FROM highlight_votes WHERE highlight_id = ? AND username = ?`).get(id, username);
  if (had) db.prepare(`DELETE FROM highlight_votes WHERE highlight_id = ? AND username = ?`).run(id, username);
  else db.prepare(`INSERT INTO highlight_votes (highlight_id, username, created_at) VALUES (?, ?, ?)`).run(id, username, now);
  return getHighlight(db, id, username);
}

export function deleteHighlight(db: Database.Database, id: string, owner: string): boolean {
  const row = db.prepare(`SELECT owner FROM highlights WHERE id = ?`).get(id) as { owner: string } | undefined;
  if (!row || row.owner !== owner) return false;
  db.prepare(`DELETE FROM highlight_votes WHERE highlight_id = ?`).run(id);
  db.prepare(`DELETE FROM highlights WHERE id = ?`).run(id);
  return true;
}
