import type Database from "better-sqlite3";
import { decryptToken, encryptToken } from "@/lib/crypto-tokens";
import { removeActivityHeat } from "@/lib/activities/heatmap";
import { ingestActivity } from "@/lib/activities/ingest";
import {
  deleteActivityRow,
  deleteExternalAccount,
  getActivityByExternal,
  getExternalAccount,
  listActivities,
  listExternalAccountsByAthlete,
  updateExternalAccountSync,
  updateExternalAccountTokens,
  upsertExternalAccount,
  type ExternalAccountRow,
} from "@/lib/activities/store";
import {
  deauthorizeStrava,
  getStravaActivity,
  listStravaActivities,
  mapStravaActivity,
  refreshStravaToken,
  stravaConfig,
  StravaError,
  type StravaTokenResponse,
} from "./strava";

/** Primo import: ultimi 12 mesi. */
const INITIAL_BACKFILL_S = 365 * 24 * 60 * 60;
/** Sync automatica al login solo se l'ultima è più vecchia di così. */
export const LOGIN_SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;
/** Pagine (×100 attività) per singola esecuzione: resta ben sotto i 100 req / 15 min. */
const MAX_PAGES_PER_RUN = 10;

const running = new Map<string, Promise<SyncResult>>();

export type SyncResult = {
  imported: number;
  skipped: number;
  pages: number;
  done: boolean;
  error?: string;
};

export function saveStravaTokens(
  db: Database.Database,
  owner: string,
  tok: StravaTokenResponse,
  scopes: string,
  now: number,
): void {
  const athlete = tok.athlete;
  const athleteName = athlete ? [athlete.firstname, athlete.lastname].filter(Boolean).join(" ") || athlete.username || null : null;
  const existing = getExternalAccount(db, owner, "strava");
  upsertExternalAccount(db, {
    owner,
    provider: "strava",
    athlete_id: athlete ? String(athlete.id) : existing?.athlete_id ?? "",
    athlete_name: athleteName ?? existing?.athlete_name ?? null,
    access_token_enc: encryptToken(tok.access_token),
    refresh_token_enc: encryptToken(tok.refresh_token),
    expires_at: tok.expires_at,
    scopes,
    now,
  });
}

/** Access token valido (refresh automatico con 5 min di margine). */
export async function getValidStravaToken(db: Database.Database, acc: ExternalAccountRow): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  if (acc.expires_at - 300 > nowS) return decryptToken(acc.access_token_enc);
  const cfg = stravaConfig();
  if (!cfg) throw new Error("Strava non configurato (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET)");
  const tok = await refreshStravaToken(cfg, decryptToken(acc.refresh_token_enc));
  updateExternalAccountTokens(
    db,
    acc.owner,
    "strava",
    {
      access_token_enc: encryptToken(tok.access_token),
      refresh_token_enc: encryptToken(tok.refresh_token),
      expires_at: tok.expires_at,
    },
    Date.now(),
  );
  return tok.access_token;
}

async function runSync(db: Database.Database, owner: string): Promise<SyncResult> {
  const acc = getExternalAccount(db, owner, "strava");
  if (!acc) return { imported: 0, skipped: 0, pages: 0, done: true, error: "Strava non collegato" };
  const result: SyncResult = { imported: 0, skipped: 0, pages: 0, done: false };
  let cursor = acc.sync_cursor > 0 ? acc.sync_cursor : Math.floor(Date.now() / 1000) - INITIAL_BACKFILL_S;
  try {
    const token = await getValidStravaToken(db, acc);
    for (let i = 0; i < MAX_PAGES_PER_RUN; i++) {
      // Con `after` Strava restituisce le attività in ordine cronologico crescente.
      const batch = await listStravaActivities(token, { after: cursor, page: 1, perPage: 100 });
      result.pages++;
      if (batch.length === 0) {
        result.done = true;
        break;
      }
      const now = Date.now();
      let maxStart = cursor;
      for (const a of batch) {
        const startS = Math.floor(Date.parse(a.start_date) / 1000);
        if (Number.isFinite(startS) && startS > maxStart) maxStart = startS;
        const mapped = mapStravaActivity(a);
        if (!mapped) {
          result.skipped++;
          continue;
        }
        const res = ingestActivity(db, {
          owner,
          provider: "strava",
          ...mapped,
          community_consent: true,
          meta: { strava_id: a.id, sport_type: a.sport_type ?? a.type ?? null },
          now,
        });
        if (res.inserted) result.imported++;
      }
      // Avanza il cursore pagina per pagina: un errore a metà non fa perdere il lavoro fatto.
      if (maxStart <= cursor) {
        result.done = true;
        break;
      }
      cursor = maxStart;
      updateExternalAccountSync(db, owner, "strava", { sync_cursor: cursor }, now);
      if (batch.length < 100) {
        result.done = true;
        break;
      }
    }
    updateExternalAccountSync(db, owner, "strava", { last_sync_at: Date.now(), status: "active", last_error: null }, Date.now());
  } catch (e) {
    const msg =
      e instanceof StravaError && e.isRateLimit
        ? "Limite di richieste Strava raggiunto: riprendo alla prossima sincronizzazione."
        : (e as Error).message;
    result.error = msg;
    const status = e instanceof StravaError && e.isAuth ? "error" : undefined;
    updateExternalAccountSync(db, owner, "strava", { last_sync_at: Date.now(), last_error: msg, status }, Date.now());
  }
  return result;
}

/** Sync incrementale; chiamate concorrenti per lo stesso utente condividono la stessa esecuzione. */
export function syncStravaAccount(db: Database.Database, owner: string): Promise<SyncResult> {
  const inFlight = running.get(owner);
  if (inFlight) return inFlight;
  const p = runSync(db, owner).finally(() => running.delete(owner));
  running.set(owner, p);
  return p;
}

export function isStravaSyncRunning(owner: string): boolean {
  return running.has(owner);
}

/** Da chiamare dopo il login (in `after()`): non lancia mai. */
export async function maybeSyncOnLogin(db: Database.Database, owner: string): Promise<void> {
  try {
    if (!stravaConfig()) return;
    const acc = getExternalAccount(db, owner, "strava");
    if (!acc || acc.status === "revoked") return;
    if (acc.last_sync_at && Date.now() - acc.last_sync_at < LOGIN_SYNC_MIN_INTERVAL_MS) return;
    const r = await syncStravaAccount(db, owner);
    console.info(`[strava] sync al login per ${owner}: +${r.imported} attività${r.error ? ` (errore: ${r.error})` : ""}`);
  } catch (e) {
    console.warn("[strava] sync al login fallita", e);
  }
}

/** Cancella tutte le attività Strava dell'utente e le relative celle heatmap. */
export function purgeStravaData(db: Database.Database, owner: string): number {
  const rows = listActivities(db, owner, { provider: "strava", limit: 5000 });
  let n = 0;
  for (const row of rows) {
    removeActivityHeat(db, row);
    if (deleteActivityRow(db, row.id)) n++;
  }
  // Più di 5000? ripeti finché vuoto.
  if (rows.length === 5000) n += purgeStravaData(db, owner);
  return n;
}

export async function disconnectStrava(db: Database.Database, owner: string): Promise<{ deleted: number }> {
  const acc = getExternalAccount(db, owner, "strava");
  if (acc) {
    try {
      await deauthorizeStrava(await getValidStravaToken(db, acc));
    } catch {
      // token già invalido: procediamo comunque con la cancellazione locale
    }
  }
  const deleted = purgeStravaData(db, owner);
  deleteExternalAccount(db, owner, "strava");
  return { deleted };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export type StravaWebhookEvent = {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
  owner_id: number;
  updates?: Record<string, string>;
  event_time?: number;
};

export async function handleStravaWebhookEvent(db: Database.Database, ev: StravaWebhookEvent): Promise<void> {
  const accounts = listExternalAccountsByAthlete(db, "strava", String(ev.owner_id));
  for (const acc of accounts) {
    if (ev.object_type === "athlete") {
      if (ev.updates?.authorized === "false") {
        purgeStravaData(db, acc.owner);
        deleteExternalAccount(db, acc.owner, "strava");
      }
      continue;
    }
    const existing = getActivityByExternal(db, acc.owner, "strava", String(ev.object_id));
    if (ev.aspect_type === "delete" || ev.updates?.private === "true") {
      if (existing) {
        removeActivityHeat(db, existing);
        deleteActivityRow(db, existing.id);
      }
      continue;
    }
    if (existing && ev.aspect_type === "update") {
      if (ev.updates?.title) db.prepare(`UPDATE activities SET name = ? WHERE id = ?`).run(ev.updates.title.slice(0, 200), existing.id);
      continue;
    }
    if (existing) continue;
    const token = await getValidStravaToken(db, acc);
    const a = await getStravaActivity(token, ev.object_id);
    const mapped = mapStravaActivity(a);
    if (!mapped) continue;
    ingestActivity(db, {
      owner: acc.owner,
      provider: "strava",
      ...mapped,
      community_consent: true,
      meta: { strava_id: a.id, sport_type: a.sport_type ?? a.type ?? null },
      now: Date.now(),
    });
  }
}
