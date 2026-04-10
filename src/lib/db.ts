import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "studio.db");
  const database = new Database(file);
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      title TEXT,
      business_name TEXT,
      sector TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
  `);
  db = database;
  return database;
}

export type SessionRow = {
  id: string;
  created_at: string;
  title: string | null;
  business_name: string | null;
  sector: string | null;
};

export function createSession(title?: string): SessionRow {
  const d = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO sessions (id, created_at, title) VALUES (?, ?, ?)`
  ).run(id, now, title ?? null);
  return {
    id,
    created_at: now,
    title: title ?? null,
    business_name: null,
    sector: null,
  };
}

export function getSession(id: string): SessionRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as SessionRow | undefined;
}

export function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
) {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)`
  ).run(sessionId, role, content, now);
}

export function listMessages(sessionId: string): { role: string; content: string }[] {
  const rows = getDb()
    .prepare(
      `SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC`
    )
    .all(sessionId) as { role: string; content: string }[];
  return rows;
}

export function saveArtifact(
  sessionId: string,
  kind: string,
  title: string | null,
  payload: unknown
) {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO artifacts (session_id, kind, title, payload, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, kind, title, JSON.stringify(payload), now);
}

export function listArtifacts(sessionId: string) {
  return getDb()
    .prepare(
      `SELECT id, kind, title, payload, created_at FROM artifacts WHERE session_id = ? ORDER BY id DESC`
    )
    .all(sessionId) as {
      id: number;
      kind: string;
      title: string | null;
      payload: string;
      created_at: string;
    }[];
}
