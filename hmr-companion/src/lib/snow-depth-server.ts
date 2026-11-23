import type Database from "better-sqlite3";
import { snowDepthNowCm, type SnowCell } from "@/lib/snow-depth";

/** Le celle si aggiornano ogni 3 ore (il modello gira 8 volte al giorno). */
const TTL_MS = 3 * 3600 * 1000;
/** Coordinate per richiesta: Open-Meteo accetta liste, l'URL resta corto. */
const BATCH = 100;

export function migrateSnowDepthCache(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snow_depth_cache (
      cell_key TEXT PRIMARY KEY,
      cm INTEGER,
      fetched_at INTEGER NOT NULL
    );
  `);
}

type OpenMeteoHourly = { hourly?: { time?: string[]; snow_depth?: (number | null)[] } };

async function fetchBatch(cells: SnowCell[], now: number): Promise<(number | null)[]> {
  const params = new URLSearchParams({
    latitude: cells.map((c) => c.lat.toFixed(4)).join(","),
    longitude: cells.map((c) => c.lng.toFixed(4)).join(","),
    hourly: "snow_depth",
    forecast_days: "1",
    timezone: "GMT",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const j = (await res.json()) as OpenMeteoHourly | OpenMeteoHourly[];
  const arr = Array.isArray(j) ? j : [j];
  return cells.map((_, i) => snowDepthNowCm(arr[i]?.hourly, now));
}

/** Altezza neve per cella: cache SQLite, poi Open-Meteo a blocchi per le celle mancanti o vecchie. */
export async function snowDepthForCells(
  db: Database.Database,
  cells: SnowCell[],
  now: number,
): Promise<(SnowCell & { cm: number | null })[]> {
  migrateSnowDepthCache(db);
  const get = db.prepare(`SELECT cm, fetched_at FROM snow_depth_cache WHERE cell_key = ?`);
  const known = new Map<string, number | null>();
  const missing: SnowCell[] = [];
  for (const c of cells) {
    const r = get.get(c.key) as { cm: number | null; fetched_at: number } | undefined;
    if (r && now - r.fetched_at < TTL_MS) known.set(c.key, r.cm);
    else missing.push(c);
  }
  if (missing.length) {
    const put = db.prepare(
      `INSERT INTO snow_depth_cache (cell_key, cm, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(cell_key) DO UPDATE SET cm = excluded.cm, fetched_at = excluded.fetched_at`,
    );
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      try {
        const vals = await fetchBatch(batch, now);
        db.transaction(() => {
          batch.forEach((c, k) => {
            known.set(c.key, vals[k]);
            put.run(c.key, vals[k], now);
          });
        })();
      } catch {
        // Servizio lento o giù: si mostrano le celle già note, le altre al prossimo spostamento.
        break;
      }
    }
  }
  return cells.map((c) => ({ ...c, cm: known.has(c.key) ? (known.get(c.key) ?? null) : null }));
}
