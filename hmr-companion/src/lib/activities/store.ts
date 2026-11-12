import crypto from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Attività importate da provider esterni (Strava) o da file (GPX/FIT/TCX/ZIP),
 * account OAuth collegati e celle della heatmap. Funzioni con `db` esplicito
 * (come `outdoor/store.ts`) così sono testabili su `:memory:`.
 */

export type ExternalProvider = "strava";
export type ActivityProvider = ExternalProvider | "upload" | "app";
export type ActivityReviewState = "pending" | "done" | "dismissed";

export type ExternalAccountRow = {
  owner: string;
  provider: ExternalProvider;
  athlete_id: string;
  athlete_name: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: number;
  scopes: string;
  status: "active" | "revoked" | "error";
  last_error: string | null;
  sync_cursor: number;
  last_sync_at: number | null;
  created_at: number;
  updated_at: number;
};

export type ActivityRow = {
  id: string;
  owner: string;
  provider: ActivityProvider;
  external_id: string;
  sport: string;
  name: string;
  start_time: number;
  distance_m: number;
  elev_gain_m: number;
  moving_time_s: number | null;
  geojson: string;
  bbox_w: number;
  bbox_s: number;
  bbox_e: number;
  bbox_n: number;
  community_consent: number;
  heat_scopes: string;
  review_state: ActivityReviewState;
  meta_json: string | null;
  created_at: number;
};

export function migrateActivitiesStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_accounts (
      owner TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('strava')),
      athlete_id TEXT NOT NULL,
      athlete_name TEXT,
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      scopes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','error')),
      last_error TEXT,
      sync_cursor INTEGER NOT NULL DEFAULT 0,
      last_sync_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_external_accounts_athlete ON external_accounts(provider, athlete_id);

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('strava','upload','app')),
      external_id TEXT NOT NULL,
      sport TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      start_time INTEGER NOT NULL,
      distance_m REAL NOT NULL DEFAULT 0,
      elev_gain_m REAL NOT NULL DEFAULT 0,
      moving_time_s INTEGER,
      geojson TEXT NOT NULL,
      bbox_w REAL NOT NULL,
      bbox_s REAL NOT NULL,
      bbox_e REAL NOT NULL,
      bbox_n REAL NOT NULL,
      community_consent INTEGER NOT NULL DEFAULT 0,
      heat_scopes TEXT NOT NULL DEFAULT '',
      review_state TEXT NOT NULL DEFAULT 'done' CHECK(review_state IN ('pending','done','dismissed')),
      meta_json TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(owner, provider, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_activities_owner_time ON activities(owner, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_review ON activities(owner, review_state);
    CREATE INDEX IF NOT EXISTS idx_activities_bbox ON activities(bbox_w, bbox_e, bbox_s, bbox_n);

    CREATE TABLE IF NOT EXISTS heat_cells (
      scope TEXT NOT NULL,
      sport TEXT NOT NULL,
      cx INTEGER NOT NULL,
      cy INTEGER NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0,
      last_seen INTEGER NOT NULL,
      PRIMARY KEY (scope, sport, cx, cy)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_heat_cells_scope_xy ON heat_cells(scope, cx, cy);
  `);
}

// ---------------------------------------------------------------------------
// external_accounts
// ---------------------------------------------------------------------------

export function upsertExternalAccount(
  db: Database.Database,
  input: {
    owner: string;
    provider: ExternalProvider;
    athlete_id: string;
    athlete_name: string | null;
    access_token_enc: string;
    refresh_token_enc: string;
    expires_at: number;
    scopes: string;
    now: number;
  },
): void {
  db.prepare(
    `INSERT INTO external_accounts
       (owner, provider, athlete_id, athlete_name, access_token_enc, refresh_token_enc, expires_at, scopes,
        status, last_error, created_at, updated_at)
     VALUES (@owner, @provider, @athlete_id, @athlete_name, @access_token_enc, @refresh_token_enc, @expires_at,
        @scopes, 'active', NULL, @now, @now)
     ON CONFLICT(owner, provider) DO UPDATE SET
       athlete_id = excluded.athlete_id,
       athlete_name = excluded.athlete_name,
       access_token_enc = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc,
       expires_at = excluded.expires_at,
       scopes = excluded.scopes,
       status = 'active',
       last_error = NULL,
       updated_at = excluded.updated_at`,
  ).run(input);
}

export function getExternalAccount(
  db: Database.Database,
  owner: string,
  provider: ExternalProvider,
): ExternalAccountRow | undefined {
  return db
    .prepare(`SELECT * FROM external_accounts WHERE owner = ? AND provider = ?`)
    .get(owner, provider) as ExternalAccountRow | undefined;
}

export function listExternalAccountsByAthlete(
  db: Database.Database,
  provider: ExternalProvider,
  athleteId: string,
): ExternalAccountRow[] {
  return db
    .prepare(`SELECT * FROM external_accounts WHERE provider = ? AND athlete_id = ?`)
    .all(provider, athleteId) as ExternalAccountRow[];
}

export function updateExternalAccountTokens(
  db: Database.Database,
  owner: string,
  provider: ExternalProvider,
  tokens: { access_token_enc: string; refresh_token_enc: string; expires_at: number },
  now: number,
): void {
  db.prepare(
    `UPDATE external_accounts
       SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, updated_at = ?
     WHERE owner = ? AND provider = ?`,
  ).run(tokens.access_token_enc, tokens.refresh_token_enc, tokens.expires_at, now, owner, provider);
}

export function updateExternalAccountSync(
  db: Database.Database,
  owner: string,
  provider: ExternalProvider,
  patch: { sync_cursor?: number; last_sync_at?: number; status?: ExternalAccountRow["status"]; last_error?: string | null },
  now: number,
): void {
  const row = getExternalAccount(db, owner, provider);
  if (!row) return;
  db.prepare(
    `UPDATE external_accounts
       SET sync_cursor = ?, last_sync_at = ?, status = ?, last_error = ?, updated_at = ?
     WHERE owner = ? AND provider = ?`,
  ).run(
    patch.sync_cursor ?? row.sync_cursor,
    patch.last_sync_at ?? row.last_sync_at,
    patch.status ?? row.status,
    patch.last_error === undefined ? row.last_error : patch.last_error,
    now,
    owner,
    provider,
  );
}

export function deleteExternalAccount(db: Database.Database, owner: string, provider: ExternalProvider): boolean {
  return db.prepare(`DELETE FROM external_accounts WHERE owner = ? AND provider = ?`).run(owner, provider).changes > 0;
}

// ---------------------------------------------------------------------------
// activities
// ---------------------------------------------------------------------------

export type NewActivity = {
  owner: string;
  provider: ActivityProvider;
  external_id: string;
  sport: string;
  name: string;
  start_time: number;
  distance_m: number;
  elev_gain_m: number;
  moving_time_s: number | null;
  line: GeoJSON.LineString;
  community_consent: boolean;
  review_state: ActivityReviewState;
  meta?: Record<string, unknown> | null;
  now: number;
};

export function lineBbox(line: GeoJSON.LineString): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const c of line.coordinates) {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return [w, s, e, n];
}

/** Inserisce l'attività se non esiste già (dedup su owner+provider+external_id). */
export function insertActivity(
  db: Database.Database,
  input: NewActivity,
): { id: string; inserted: boolean } {
  const existing = getActivityByExternal(db, input.owner, input.provider, input.external_id);
  if (existing) return { id: existing.id, inserted: false };
  const id = crypto.randomUUID();
  const [w, s, e, n] = lineBbox(input.line);
  db.prepare(
    `INSERT INTO activities
       (id, owner, provider, external_id, sport, name, start_time, distance_m, elev_gain_m, moving_time_s,
        geojson, bbox_w, bbox_s, bbox_e, bbox_n, community_consent, heat_scopes, review_state, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
  ).run(
    id,
    input.owner,
    input.provider,
    input.external_id,
    input.sport,
    input.name,
    input.start_time,
    input.distance_m,
    input.elev_gain_m,
    input.moving_time_s,
    JSON.stringify(input.line),
    w,
    s,
    e,
    n,
    input.community_consent ? 1 : 0,
    input.review_state,
    input.meta ? JSON.stringify(input.meta) : null,
    input.now,
  );
  return { id, inserted: true };
}

export function getActivity(db: Database.Database, id: string): ActivityRow | undefined {
  return db.prepare(`SELECT * FROM activities WHERE id = ?`).get(id) as ActivityRow | undefined;
}

export function getActivityByExternal(
  db: Database.Database,
  owner: string,
  provider: ActivityProvider,
  externalId: string,
): ActivityRow | undefined {
  return db
    .prepare(`SELECT * FROM activities WHERE owner = ? AND provider = ? AND external_id = ?`)
    .get(owner, provider, externalId) as ActivityRow | undefined;
}

export function listActivities(
  db: Database.Database,
  owner: string,
  opts: { limit?: number; reviewState?: ActivityReviewState; provider?: ActivityProvider } = {},
): ActivityRow[] {
  const where = ["owner = ?"];
  const args: unknown[] = [owner];
  if (opts.reviewState) {
    where.push("review_state = ?");
    args.push(opts.reviewState);
  }
  if (opts.provider) {
    where.push("provider = ?");
    args.push(opts.provider);
  }
  args.push(Math.min(Math.max(opts.limit ?? 50, 1), 5000));
  return db
    .prepare(`SELECT * FROM activities WHERE ${where.join(" AND ")} ORDER BY start_time DESC LIMIT ?`)
    .all(...args) as ActivityRow[];
}

export function countActivitiesByProvider(db: Database.Database, owner: string): Record<string, number> {
  const rows = db
    .prepare(`SELECT provider, COUNT(*) AS n FROM activities WHERE owner = ? GROUP BY provider`)
    .all(owner) as { provider: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.provider, r.n]));
}

export function setActivityHeatScopes(db: Database.Database, id: string, scopes: string[]): void {
  db.prepare(`UPDATE activities SET heat_scopes = ? WHERE id = ?`).run(scopes.join(","), id);
}

export function setActivityReviewState(db: Database.Database, id: string, state: ActivityReviewState): void {
  db.prepare(`UPDATE activities SET review_state = ? WHERE id = ?`).run(state, id);
}

export function setActivityCommunityConsent(db: Database.Database, id: string, consent: boolean): void {
  db.prepare(`UPDATE activities SET community_consent = ? WHERE id = ?`).run(
    consent ? 1 : 0,
    id,
  );
}

export function deleteActivityRow(db: Database.Database, id: string): boolean {
  return db.prepare(`DELETE FROM activities WHERE id = ?`).run(id).changes > 0;
}

export function parseActivityLine(row: Pick<ActivityRow, "geojson">): GeoJSON.LineString {
  return JSON.parse(row.geojson) as GeoJSON.LineString;
}
