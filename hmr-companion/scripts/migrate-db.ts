/**
 * Esegue le migrazioni SQLite (apertura DB) e stampa un riepilogo.
 * npm run db:migrate
 */
import { getDb } from "../src/lib/db";

const db = getDb();
const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_routes'`).get() as { sql: string };
console.log(row.sql.match(/CHECK\(activity IN \([^)]*\)\)/)?.[0] ?? "user_routes: CHECK non trovato");
console.log("user_routes:", (db.prepare(`SELECT count(*) AS n FROM user_routes`).get() as { n: number }).n);
db.close();
