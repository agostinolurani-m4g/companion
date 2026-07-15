import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addGroupMember,
  addOutingGroup,
  addOutingParticipant,
  canViewSkiOuting,
  countOutingsVisibleForRoute,
  getDb,
  insertGroup,
  insertSkiOuting,
  insertUserRoute,
  listOutingsVisibleForRoute,
  listOutingsVisibleForUser,
  listPublicSkiRoutes,
  listSkiRoutesForGroup,
  listSkiRoutesForMyOutings,
  resetDbConnection,
} from "../db";
import { routesToExploreGeoJson } from "../ski-explore";

describe("ski outings db", () => {
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
    insertSkiOuting({
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

    insertSkiOuting({
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
    insertSkiOuting({
      id: "o3",
      route_id: "r4",
      owner: "alice",
      title: "Gita alice",
      outing_date: "2026-01-15",
      created_at: now,
      updated_at: now,
    });
    insertSkiOuting({
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
    expect(canViewSkiOuting("o4", "alice")).toBe(true);
    expect(canViewSkiOuting("o4", "carol")).toBe(false);
    expect(countOutingsVisibleForRoute("r4", "alice")).toBe(2);
    expect(listOutingsVisibleForUser("bob")).toHaveLength(2);
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
