import { getDb } from "@/lib/db";
import { normalizeUsername } from "@/lib/auth";

export const UNLIMITED_INGEST_USERS = new Set(["ago"]);

const DEFAULT_CREDITS = 1;

export type IngestCreditsInfo = {
  username: string;
  unlimited: boolean;
  creditsRemaining: number | null;
  canIngest: boolean;
};

function ensureCreditsTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS user_ingest_credits (
      username TEXT PRIMARY KEY,
      credits_remaining INTEGER NOT NULL DEFAULT ${DEFAULT_CREDITS}
    );
  `);
}

export function isUnlimitedIngestUser(username: string): boolean {
  return UNLIMITED_INGEST_USERS.has(normalizeUsername(username));
}

export function getIngestCreditsInfo(username: string): IngestCreditsInfo {
  ensureCreditsTable();
  const u = normalizeUsername(username);
  if (isUnlimitedIngestUser(u)) {
    return { username: u, unlimited: true, creditsRemaining: null, canIngest: true };
  }
  const row = getDb()
    .prepare(`SELECT credits_remaining FROM user_ingest_credits WHERE username = ?`)
    .get(u) as { credits_remaining: number } | undefined;
  const remaining = row?.credits_remaining ?? DEFAULT_CREDITS;
  return {
    username: u,
    unlimited: false,
    creditsRemaining: remaining,
    canIngest: remaining > 0,
  };
}

export function assertCanIngest(username: string): void {
  const info = getIngestCreditsInfo(username);
  if (!info.canIngest) {
    throw new Error("Credito ingest esaurito. Contatta l'amministratore per un nuovo credito.");
  }
}

export function consumeIngestCredit(username: string): void {
  if (isUnlimitedIngestUser(username)) return;
  ensureCreditsTable();
  const u = normalizeUsername(username);
  const db = getDb();
  const row = db
    .prepare(`SELECT credits_remaining FROM user_ingest_credits WHERE username = ?`)
    .get(u) as { credits_remaining: number } | undefined;
  if (!row) {
    db.prepare(
      `INSERT INTO user_ingest_credits (username, credits_remaining) VALUES (?, ?)`
    ).run(u, DEFAULT_CREDITS - 1);
    return;
  }
  if (row.credits_remaining <= 0) return;
  db.prepare(
    `UPDATE user_ingest_credits SET credits_remaining = credits_remaining - 1 WHERE username = ?`
  ).run(u);
}
