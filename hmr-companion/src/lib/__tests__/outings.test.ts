import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addGroupMember,
  addOutingGroup,
  addOutingParticipant,
  canViewOuting,
  countOutingsVisibleForRoute,
  getDb,
  insertGroup,
  insertOuting,
  insertUserRoute,
  deleteOuting,
  getOuting,
  insertUserPhoto,
  listOutingStops,
  listOutingsVisibleForRoute,
  listUserPhotosForOuting,
  replaceOutingStops,
  updateOuting,
  listOutingsVisibleForUser,
  listPublicSkiRoutes,
  listSkiRoutesForGroup,
  listSkiRoutesForMyOutings,
  resetDbConnection,
} from "../db";
import { routesToExploreGeoJson } from "../ski-explore";
import { serializeOuting } from "../outings";

describe("outings db", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hmr-ski-out-"));
    process.env.HMR_DB_PATH = path.join(tmpDir, "test.db");
    resetDbConnection();
    getDb();
  });

  afterEach(() => {
    resetDbConnection();
    delete process.env.HMR_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedRoute(id: string, owner: string, name: string) {
    const now = Date.now();
    insertUserRoute({
      id,
      owner,
      name,
      activity: "ski",
      geojson: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { mode: "ascent" },
            geometry: {
              type: "LineString",
              coordinates: [
                [9, 46],
                [9.01, 46.01],
              ],
            },
          },
        ],
      }),
      waypoints_json: JSON.stringify({ ascent: [], descent: [] }),
      length_km: 1.2,
      elev_gain_m: 100,
      elev_loss_m: 0,
      visibility: "public",
      created_at: now,
      updated_at: now,
    });
  }

  it("lists public ski routes", () => {
    seedRoute("r1", "alice", "Cima A");
    const rows = listPublicSkiRoutes();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Cima A");
  });

  it("lists routes for my outings as owner or participant", () => {
    seedRoute("r2", "alice", "Cima B");
    const now = Date.now();
    insertOuting({
      id: "o1",
      route_id: "r2",
      owner: "alice",
      title: "Gita gennaio",
      created_at: now,
      updated_at: now,
    });
    addOutingParticipant("o1", "alice");
    addOutingParticipant("o1", "bob");

    expect(listSkiRoutesForMyOutings("alice")).toHaveLength(1);
    expect(listSkiRoutesForMyOutings("bob")).toHaveLength(1);
    expect(listSkiRoutesForMyOutings("carol")).toHaveLength(0);
  });

  it("lists routes shared with a group", () => {
    seedRoute("r3", "alice", "Cima C");
    const now = Date.now();
    const gid = crypto.randomUUID();
    insertGroup({
      id: gid,
      name: "Gruppo test",
      type: "friends",
      description: "",
      created_by: "alice",
      created_at: now,
      updated_at: now,
    });
    addGroupMember({ group_id: gid, username: "alice", role: "owner", joined_at: now });

    insertOuting({
      id: "o2",
      route_id: "r3",
      owner: "alice",
      title: "Uscita gruppo",
      created_at: now,
      updated_at: now,
    });
    addOutingGroup("o2", gid);

    const routes = listSkiRoutesForGroup(gid);
    expect(routes).toHaveLength(1);
    expect(routes[0].id).toBe("r3");
  });

  it("lists outings visible to user on a route", () => {
    seedRoute("r4", "alice", "Cima D");
    const now = Date.now();
    insertOuting({
      id: "o3",
      route_id: "r4",
      owner: "alice",
      title: "Gita alice",
      outing_date: "2026-01-15",
      created_at: now,
      updated_at: now,
    });
    insertOuting({
      id: "o4",
      route_id: "r4",
      owner: "bob",
      title: "Gita bob",
      created_at: now,
      updated_at: now,
    });
    addOutingParticipant("o3", "bob");

    expect(listOutingsVisibleForRoute("r4", "alice")).toHaveLength(2);
    expect(listOutingsVisibleForRoute("r4", "bob")).toHaveLength(2);
    expect(listOutingsVisibleForRoute("r4", "carol")).toHaveLength(0);
    expect(canViewOuting("o4", "alice")).toBe(true);
    expect(canViewOuting("o4", "carol")).toBe(false);
    expect(countOutingsVisibleForRoute("r4", "alice")).toBe(2);
    expect(listOutingsVisibleForUser("bob")).toHaveLength(2);
  });

  it("public outings are visible to everyone", () => {
    seedRoute("r5", "alice", "Cima E");
    const now = Date.now();
    insertOuting({ id: "o5", route_id: "r5", owner: "alice", title: "Pubblica", created_at: now, updated_at: now });
    expect(canViewOuting("o5", "carol")).toBe(false);
    updateOuting("o5", { visibility: "public" });
    expect(canViewOuting("o5", "carol")).toBe(true);
  });

  it("plans with stops, then reports as done", () => {
    seedRoute("r6", "alice", "Cima F");
    const now = Date.now();
    insertOuting({ id: "o6", route_id: "r6", owner: "alice", title: "Piano", created_at: now, updated_at: now });
    expect(getOuting("o6")!.status).toBe("planned");
    replaceOutingStops("o6", [
      { role: "start", kind: "parking", name: "P", lng: 9, lat: 46, along_km: 0, ref: null, note: "" },
      { role: "stop", kind: "hut", name: "Rifugio", lng: 9.005, lat: 46.005, along_km: 0.6, ref: "osm:1", note: "" },
    ]);
    expect(listOutingStops("o6").map((s) => s.name)).toEqual(["P", "Rifugio"]);
    updateOuting("o6", {
      status: "done",
      story: "Bella giornata",
      conditions_json: JSON.stringify({ snow: { quality: "powder" } }),
    });
    insertUserPhoto({ id: "ph1", owner: "alice", lng: 9, lat: 46, photo_path: "x.jpg", outing_id: "o6", created_at: now });
    const dto = serializeOuting(getOuting("o6")!);
    expect(dto.status).toBe("done");
    expect(dto.story).toBe("Bella giornata");
    expect(dto.conditions?.snow?.quality).toBe("powder");
    expect(dto.stops).toHaveLength(2);
    expect(dto.photos).toHaveLength(1);
    expect(dto.route_name).toBe("Cima F");

    expect(deleteOuting("o6")).toBe(true);
    expect(listOutingStops("o6")).toHaveLength(0);
    expect(listUserPhotosForOuting("o6")).toHaveLength(0);
  });
});

describe("outings migration", () => {
  let tmpDir: string;
  afterEach(() => {
    resetDbConnection();
    delete process.env.HMR_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("upgrades legacy ski_outings: done status, notes become story", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hmr-out-mig-"));
    const file = path.join(tmpDir, "legacy.db");
    const Database = (await import("better-sqlite3")).default;
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE ski_outings (id TEXT PRIMARY KEY, route_id TEXT NOT NULL, owner TEXT NOT NULL,
        title TEXT NOT NULL, outing_date TEXT, snow_notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO ski_outings VALUES ('old', 'r', 'alice', 'Vecchia', '2025-02-01', 'polvere in alto', 1, 1);
    `);
    legacy.close();
    process.env.HMR_DB_PATH = file;
    resetDbConnection();
    getDb();
    const row = getOuting("old")!;
    expect(row.status).toBe("done");
    expect(row.story).toBe("polvere in alto");
    expect(row.notes).toBe("");
    expect(row.visibility).toBe("participants");
    const tables = getDb().prepare(`SELECT name FROM sqlite_master WHERE name = 'ski_outings'`).all();
    expect(tables).toHaveLength(0);
  });
});

describe("routesToExploreGeoJson", () => {
  it("builds line features without waypoints", () => {
    const fc = routesToExploreGeoJson([
      {
        id: "x",
        owner: "alice",
        name: "Test",
        activity: "ski",
        geojson: JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { mode: "ascent" },
              geometry: {
                type: "LineString",
                coordinates: [
                  [9, 46],
                  [9.1, 46.1],
                ],
              },
            },
          ],
        }),
        waypoints_json: "[]",
        length_km: 5,
        elev_gain_m: 0,
        elev_loss_m: 0,
        visibility: "public",
        source: null,
        source_url: null,
        license: null,
        external_id: null,
        meta_json: null,
        created_at: 0,
        updated_at: 0,
      },
    ]);
    expect(fc.features).toHaveLength(1);
    expect((fc.features[0].properties as { routeId: string }).routeId).toBe("x");
  });
});
