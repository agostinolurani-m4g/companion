import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbConnection } from "../db";

/**
 * Regressione: in produzione il DB esisteva già con lo schema vecchio di
 * user_routes (senza source/external_id). Lo schema iniziale creava un indice
 * su `source` prima della migrazione che aggiunge la colonna → ogni query
 * falliva con "no such column: source".
 */
describe("db upgrade from legacy schema", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hmr-legacy-"));
    dbPath = path.join(tmpDir, "legacy.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE user_routes (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        activity TEXT NOT NULL CHECK(activity IN ('road','mtb','hike')),
        geojson TEXT NOT NULL,
        waypoints_json TEXT NOT NULL DEFAULT '[]',
        length_km REAL NOT NULL DEFAULT 0,
        elev_gain_m REAL NOT NULL DEFAULT 0,
        elev_loss_m REAL NOT NULL DEFAULT 0,
        visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO user_routes (id, owner, name, activity, geojson, created_at, updated_at)
      VALUES ('r1', 'ago', 'giro', 'road', '{}', 1, 1);
    `);
    legacy.close();
    process.env.HMR_DB_PATH = dbPath;
    resetDbConnection();
  });

  afterEach(() => {
    resetDbConnection();
    delete process.env.HMR_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("opens a legacy database, adds the new columns and keeps the rows", () => {
    const db = getDb();
    const cols = (db.prepare(`PRAGMA table_info(user_routes)`).all() as { name: string }[]).map(
      (c) => c.name
    );
    expect(cols).toEqual(expect.arrayContaining(["source", "source_url", "external_id", "meta_json"]));
    const row = db.prepare(`SELECT id, owner, activity FROM user_routes WHERE id = 'r1'`).get();
    expect(row).toEqual({ id: "r1", owner: "ago", activity: "road" });
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_routes_source_ext'`)
      .get();
    expect(idx).toBeDefined();
  });

  it("is idempotent across restarts", () => {
    getDb();
    resetDbConnection();
    expect(() => getDb()).not.toThrow();
  });
});
