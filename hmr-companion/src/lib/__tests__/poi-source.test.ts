import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertLocalOsmPoiBatch,
  localCoverageContainsBbox,
  localPoiCount,
  queryLocalPoisAround,
  queryLocalPoisInBbox,
  resetDbConnection,
  resetLocalOsmStore,
  setLocalOsmCoverage,
} from "../db";
import { getPoiTypesAround, getPoiTypesInBbox } from "../poi-source";

vi.mock("../overpass", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../overpass")>();
  return {
    ...actual,
    fetchPoiTypesInBbox: vi.fn(async () => []),
    fetchPoiTypesAround: vi.fn(async () => []),
  };
});

describe("local OSM POI store", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    resetDbConnection();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hmr-osm-poi-"));
    dbPath = path.join(tmpDir, "test.db");
    process.env.HMR_DB_PATH = dbPath;
    resetLocalOsmStore();
    setLocalOsmCoverage({
      region: "italy",
      south: 35.4,
      west: 6.6,
      north: 47.1,
      east: 18.6,
      imported_at: Math.floor(Date.now() / 1000),
    });
    insertLocalOsmPoiBatch([
      {
        osm_type: "node",
        osm_id: 1,
        category: "water",
        sub_kind: "drinking_water",
        lat: 45.46,
        lng: 9.19,
        tags: { amenity: "drinking_water", name: "Fontana Duomo" },
      },
      {
        osm_type: "node",
        osm_id: 2,
        category: "restaurant",
        sub_kind: "restaurant",
        lat: 45.465,
        lng: 9.195,
        tags: { amenity: "restaurant", name: "Trattoria" },
      },
      {
        osm_type: "way",
        osm_id: 3,
        category: "shop",
        sub_kind: "supermarket",
        lat: 45.47,
        lng: 9.2,
        tags: { shop: "supermarket", name: "Coop" },
      },
    ]);
  });

  afterEach(() => {
    resetDbConnection();
    delete process.env.HMR_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("inserisce e conta POI locali", () => {
    expect(localPoiCount()).toBe(3);
    expect(localCoverageContainsBbox(45.45, 9.18, 45.48, 9.21)).toBe(true);
    expect(localCoverageContainsBbox(50, 10, 51, 11)).toBe(false);
  });

  it("query bbox restituisce POI nell'area", () => {
    const rows = queryLocalPoisInBbox(45.45, 9.18, 45.48, 9.21, null);
    expect(rows).toHaveLength(3);
    const water = queryLocalPoisInBbox(45.45, 9.18, 45.48, 9.21, ["water"]);
    expect(water).toHaveLength(1);
    expect(water[0]?.sub_kind).toBe("drinking_water");
  });

  it("query around filtra per raggio", () => {
    const near = queryLocalPoisAround(45.46, 9.19, 500, null);
    expect(near.length).toBeGreaterThanOrEqual(1);
    const far = queryLocalPoisAround(45.46, 9.19, 50, null);
    expect(far).toHaveLength(1);
  });

  it("resolver usa sorgente local dentro copertura", async () => {
    const bbox = [45.45, 9.18, 45.48, 9.21] as [number, number, number, number];
    const inBbox = await getPoiTypesInBbox(bbox, null);
    expect(inBbox.source).toBe("local");
    expect(inBbox.nodes).toHaveLength(3);

    const around = await getPoiTypesAround(45.46, 9.19, 800, null);
    expect(around.source).toBe("local");
    expect(around.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("resolver fa fallback overpass fuori copertura", async () => {
    const bbox = [48.8, 2.3, 48.9, 2.4] as [number, number, number, number];
    const result = await getPoiTypesInBbox(bbox, null);
    expect(result.source).toBe("overpass");
  });
});
