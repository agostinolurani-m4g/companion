import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregationFactor,
  cellToLngLat,
  cellsForLine,
  COMMUNITY_SCOPE,
  COMMUNITY_TRIM_M,
  lngLatToCell,
  personalScope,
  queryHeat,
  removeActivityHeat,
  routePopularity,
  syncActivityHeat,
  trimLineEnds,
} from "@/lib/activities/heatmap";
import { ingestActivity } from "@/lib/activities/ingest";
import { getActivity, migrateActivitiesStore, setActivityCommunityConsent } from "@/lib/activities/store";

/** Linea est-ovest di ~1.5 km in Valtellina. */
const LINE: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [9.9, 46.3],
    [9.91, 46.3],
    [9.92, 46.3],
  ],
};

function add(db: Database.Database, owner: string, provider: "strava" | "upload", consent: boolean, ext: string, line = LINE) {
  return ingestActivity(db, {
    owner,
    provider,
    external_id: ext,
    sport: "hike",
    name: ext,
    start_time: Date.UTC(2026, 9, 1),
    line,
    distance_m: 1500,
    elev_gain_m: 0,
    moving_time_s: null,
    community_consent: consent,
    now: Date.UTC(2026, 10, 1),
  });
}

function sumHits(db: Database.Database, scope: string): number {
  return (db.prepare(`SELECT COALESCE(SUM(hits),0) AS n FROM heat_cells WHERE scope = ?`).get(scope) as { n: number }).n;
}

describe("heatmap grid", () => {
  it("cella ↔ lng/lat è coerente", () => {
    const [cx, cy] = lngLatToCell(9.9, 46.3);
    const [lng, lat] = cellToLngLat(cx + 0.5, cy + 0.5);
    expect(Math.abs(lng - 9.9)).toBeLessThan(0.0005);
    expect(Math.abs(lat - 46.3)).toBeLessThan(0.0005);
  });

  it("dedup per attività: un andata-ritorno conta 1 per cella", () => {
    const outAndBack = [...LINE.coordinates, ...[...LINE.coordinates].reverse()];
    expect(cellsForLine(outAndBack).size).toBe(cellsForLine(LINE.coordinates).size);
  });

  it("fattore di aggregazione cresce allo zoom out", () => {
    expect(aggregationFactor(16)).toBe(1);
    expect(aggregationFactor(8)).toBeGreaterThan(aggregationFactor(12));
  });
});

describe("heatmap scopes", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    migrateActivitiesStore(db);
  });

  it("attività Strava: entra nella community in forma aggregata, si può escludere", () => {
    const { id } = add(db, "ago", "strava", true, "s1");
    const row = getActivity(db, id)!;
    expect(row.community_consent).toBe(1);
    expect(row.heat_scopes.split(",")).toEqual([personalScope("ago"), COMMUNITY_SCOPE]);
    expect(sumHits(db, COMMUNITY_SCOPE)).toBeGreaterThan(0);
    setActivityCommunityConsent(db, id, false);
    syncActivityHeat(db, getActivity(db, id)!);
    expect(sumHits(db, COMMUNITY_SCOPE)).toBe(0);
    expect(sumHits(db, personalScope("ago"))).toBeGreaterThan(0);
  });

  it("zona privacy: inizio e fine traccia non entrano nella community", () => {
    add(db, "ago", "upload", true, "u1");
    const personal = sumHits(db, personalScope("ago"));
    const community = sumHits(db, COMMUNITY_SCOPE);
    expect(community).toBeGreaterThan(0);
    expect(community).toBeLessThan(personal);
    const [sx, sy] = lngLatToCell(9.9, 46.3);
    const startCell = db
      .prepare(`SELECT hits FROM heat_cells WHERE scope = ? AND cx = ? AND cy = ?`)
      .get(COMMUNITY_SCOPE, sx, sy);
    expect(startCell).toBeUndefined();
    expect(trimLineEnds([[9.9, 46.3], [9.901, 46.3]], COMMUNITY_TRIM_M)).toEqual([]);
  });

  it("upload con consenso: personale + community; revoca consenso rimuove la community", () => {
    const { id } = add(db, "ale", "upload", true, "u1");
    expect(sumHits(db, COMMUNITY_SCOPE)).toBeGreaterThan(0);
    setActivityCommunityConsent(db, id, false);
    syncActivityHeat(db, getActivity(db, id)!);
    expect(sumHits(db, COMMUNITY_SCOPE)).toBe(0);
    expect(sumHits(db, personalScope("ale"))).toBeGreaterThan(0);
  });

  it("dedup import e removeActivityHeat", () => {
    const a = add(db, "ale", "upload", true, "u1");
    const b = add(db, "ale", "upload", true, "u1");
    expect(b.inserted).toBe(false);
    expect(b.id).toBe(a.id);
    removeActivityHeat(db, getActivity(db, a.id)!);
    expect(sumHits(db, COMMUNITY_SCOPE)).toBe(0);
    expect(sumHits(db, personalScope("ale"))).toBe(0);
  });

  it("queryHeat somma le passate di utenti diversi", () => {
    add(db, "ale", "upload", true, "u1");
    add(db, "gala", "upload", true, "u2");
    const res = queryHeat(db, { scope: COMMUNITY_SCOPE, bbox: [9.85, 46.25, 9.95, 46.35], zoom: 15 });
    expect(res.features.length).toBeGreaterThan(10);
    expect(res.max).toBe(2);
    const other = queryHeat(db, { scope: COMMUNITY_SCOPE, bbox: [10.5, 46.25, 10.6, 46.35], zoom: 15 });
    expect(other.features).toHaveLength(0);
  });

  it("routePopularity: percorso sulla traccia community vs. variante nuova", () => {
    add(db, "ale", "upload", true, "u1");
    add(db, "marti", "strava", false, "s9");
    // tratto centrale (le zone privacy a inizio/fine non contano nella community)
    const on = routePopularity(db, [[9.905, 46.3], [9.915, 46.3]], { owner: "ago" });
    expect(on.has_community_data).toBe(true);
    expect(on.community_pct).toBeGreaterThan(90);
    expect(on.personal_pct).toBe(0);

    const detour: GeoJSON.Position[] = [
      [9.9, 46.3],
      [9.91, 46.3],
      [9.91, 46.31],
      [9.92, 46.31],
    ];
    const off = routePopularity(db, detour);
    expect(off.community_pct).toBeLessThan(60);
    expect(off.untrodden.length).toBeGreaterThan(0);
  });

  it("routePopularity personale conta anche Strava", () => {
    add(db, "ago", "strava", false, "s1");
    const p = routePopularity(db, LINE.coordinates, { owner: "ago" });
    expect(p.personal_pct).toBeGreaterThan(90);
    expect(p.has_community_data).toBe(false);
  });
});
