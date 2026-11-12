import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activitiesForQuery, activityFilterSql, isAffinityMatch } from "@/lib/sport-affinity";
import { insertUserRoute, listPublicRoutesInBbox, listRoutesForExplore, resetDbConnection, type UserRouteActivity } from "../db";

describe("sport affinity mapping", () => {
  it("includes related sports, requested first", () => {
    expect(activitiesForQuery("run")).toEqual(["run", "hike", "walk"]);
    expect(activitiesForQuery("trail_run")).toEqual(["trail_run", "hike", "walk"]);
    expect(activitiesForQuery("ebike")).toEqual(["ebike", "mtb", "road"]);
    expect(activitiesForQuery("hike")).toEqual(["hike"]);
    expect(activitiesForQuery("gravel")).toEqual(["gravel"]);
  });
  it("builds SQL with named params and the cycle-network clause", () => {
    const run = activityFilterSql("run");
    expect(run.sql).toBe("activity IN (@aff_a0, @aff_a1, @aff_a2)");
    expect(run.params).toEqual({ aff_a0: "run", aff_a1: "hike", aff_a2: "walk" });
    const gr = activityFilterSql("gravel", "r.");
    expect(gr.sql).toContain("r.activity IN (@aff_a0)");
    expect(gr.sql).toContain("json_extract(r.meta_json, '$.network') IN ('icn', 'ncn', 'rcn')");
    expect(isAffinityMatch("run", "hike")).toBe(true);
    expect(isAffinityMatch(null, "hike")).toBe(false);
  });
});

describe("sport affinity in queries", () => {
  let tmpDir: string;
  const bbox = { south: 45.9, west: 8.9, north: 46.2, east: 9.3 };

  function add(id: string, activity: UserRouteActivity, meta: Record<string, unknown> | null = null, lengthKm = 10) {
    const now = Date.now();
    insertUserRoute({
      id,
      owner: "osm",
      name: id,
      activity,
      geojson: JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[9, 46], [9.1, 46.05]] } }),
      waypoints_json: "[]",
      length_km: lengthKm,
      elev_gain_m: 100,
      elev_loss_m: 100,
      visibility: "public",
      source: "osm",
      external_id: id,
      meta_json: meta ? JSON.stringify(meta) : null,
      created_at: now,
      updated_at: now,
    });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hmr-affinity-"));
    process.env.HMR_DB_PATH = path.join(tmpDir, "test.db");
    resetDbConnection();
    add("hike1", "hike");
    add("walk1", "walk");
    add("mtb1", "mtb");
    add("road-local", "road", { network: "lcn" });
    add("road-rcn", "road", { network: "rcn" });
    add("run1", "run");
  });

  afterEach(() => {
    resetDbConnection();
    delete process.env.HMR_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run sees hike and walk, exact sport first, never mtb", () => {
    const res = listPublicRoutesInBbox("run", bbox);
    expect(res.total).toBe(3);
    expect(res.rows[0]!.id).toBe("run1");
    expect(res.rows.map((r) => r.id).sort()).toEqual(["hike1", "run1", "walk1"]);
  });

  it("ebike sees mtb and road", () => {
    expect(listPublicRoutesInBbox("ebike", bbox).rows.map((r) => r.id).sort()).toEqual(["mtb1", "road-local", "road-rcn"]);
  });

  it("gravel and bikepacking see only cycle networks", () => {
    expect(listPublicRoutesInBbox("gravel", bbox).rows.map((r) => r.id)).toEqual(["road-rcn"]);
    expect(listRoutesForExplore("bikepacking", "public", "u").map((r) => r.id)).toEqual(["road-rcn"]);
  });

  it("hike stays exact", () => {
    expect(listPublicRoutesInBbox("hike", bbox).rows.map((r) => r.id)).toEqual(["hike1"]);
  });

  it("short / partial OSM relations are ranked after complete ones", () => {
    add("hike-short", "hike", null, 1.2);
    add("hike-partial", "hike", { coverage: 0.7 });
    add("hike2", "hike", { coverage: 1, quality: 1 });
    const ids = listPublicRoutesInBbox("hike", bbox).rows.map((r) => r.id);
    expect(ids.slice(0, 2).sort()).toEqual(["hike1", "hike2"]);
    expect(ids.slice(2).sort()).toEqual(["hike-partial", "hike-short"]);
  });
});
