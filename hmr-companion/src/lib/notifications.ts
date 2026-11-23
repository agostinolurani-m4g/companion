import crypto from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Notifiche in-app (SQLite). Per ora: segmenti (nuovo record, corona presa/persa).
 * Nessun push: la campanella nella barra le mostra alla prossima apertura.
 */

export type NotificationKind = "segment_pr" | "segment_crown" | "segment_crown_lost";

export type NotificationRow = {
  id: string;
  username: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string | null;
  created_at: number;
  read_at: number | null;
};

export function migrateNotifications(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      href TEXT,
      dedup_key TEXT,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(username, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_dedup ON user_notifications(username, dedup_key);
  `);
}

export function addNotification(
  db: Database.Database,
  n: { username: string; kind: NotificationKind; title: string; body?: string; href?: string | null; dedupKey?: string; now: number },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO user_notifications (id, username, kind, title, body, href, dedup_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), n.username, n.kind, n.title, n.body ?? "", n.href ?? null, n.dedupKey ?? null, n.now);
}

export function listNotifications(db: Database.Database, username: string, limit = 30): NotificationRow[] {
  return db
    .prepare(
      `SELECT id, username, kind, title, body, href, created_at, read_at FROM user_notifications
       WHERE username = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(username, limit) as NotificationRow[];
}

export function unreadCount(db: Database.Database, username: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM user_notifications WHERE username = ? AND read_at IS NULL`).get(username) as { n: number }).n;
}

export function markNotificationsRead(db: Database.Database, username: string, now: number, ids?: string[]): void {
  if (ids?.length) {
    const st = db.prepare(`UPDATE user_notifications SET read_at = ? WHERE username = ? AND id = ? AND read_at IS NULL`);
    for (const id of ids) st.run(now, username, id);
    return;
  }
  db.prepare(`UPDATE user_notifications SET read_at = ? WHERE username = ? AND read_at IS NULL`).run(now, username);
}
