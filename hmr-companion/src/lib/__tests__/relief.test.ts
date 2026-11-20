import { describe, expect, it } from "vitest";
import {
  bboxToMercator,
  bufferBbox,
  cellKey,
  cellsToGeoJson,
  corridorCells,
  isReliefManifest,
  reliefMode,
  type ReliefManifest,
} from "@/lib/map/relief";

const CELL = 0.02;

/** Manifest con un blocco pieno di celle attorno a (21.0, 39.0) ± 0.1°. */
function blockManifest(): ReliefManifest {
  const cells: string[] = [];
  for (let i = Math.floor(20.9 / CELL); i <= Math.floor(21.1 / CELL); i++) {
    for (let j = Math.floor(38.9 / CELL); j <= Math.floor(39.1 / CELL); j++) cells.push(`${i}:${j}`);
  }
  return { bounds: [20.9, 38.9, 21.1, 39.1], minzoom: 10, maxzoom: 13, cellDeg: CELL, cells };
}

describe("isReliefManifest", () => {
  it("accepts a valid manifest", () => {
    expect(isReliefManifest(blockManifest())).toBe(true);
  });

  it("rejects missing or malformed fields", () => {
    expect(isReliefManifest(null)).toBe(false);
    expect(isReliefManifest({ bounds: [0, 0, 1], minzoom: 10, maxzoom: 13, cellDeg: CELL, cells: [] })).toBe(false);
    expect(isReliefManifest({ bounds: [0, 0, 1, 1], minzoom: 14, maxzoom: 13, cellDeg: CELL, cells: [] })).toBe(false);
    expect(isReliefManifest({ bounds: [0, 0, 1, 1], minzoom: 10, maxzoom: 13, cellDeg: 0, cells: [] })).toBe(false);
    expect(isReliefManifest({ bounds: [0, 0, 1, 1], minzoom: 10, maxzoom: 13, cellDeg: CELL })).toBe(false);
  });
});

describe("reliefMode", () => {
  const m = blockManifest();

  it("uses the runtime hillshade without a manifest", () => {
    expect(reliefMode([20.99, 38.99, 21.01, 39.01], 12, null)).toBe("runtime");
  });

  it("uses the precomputed relief when the whole view is inside the corridor", () => {
    expect(reliefMode([20.95, 38.95, 21.05, 39.05], 12, m)).toBe("pre");
  });

  it("falls back to runtime when part of the view leaves the corridor", () => {
    expect(reliefMode([20.95, 38.95, 21.3, 39.05], 12, m)).toBe("runtime");
  });

  it("falls back to runtime outside the zoom range (allowing 2 levels of overzoom)", () => {
    expect(reliefMode([20.99, 38.99, 21.01, 39.01], 9, m)).toBe("runtime");
    expect(reliefMode([20.99, 38.99, 21.01, 39.01], 15, m)).toBe("pre");
    expect(reliefMode([20.99, 38.99, 21.01, 39.01], 15.5, m)).toBe("runtime");
  });
});

describe("corridorCells", () => {
  it("covers the buffer around a single point", () => {
    const cells = new Set(corridorCells([[21, 39]], 3, CELL));
    expect(cells.has(cellKey(21, 39, CELL))).toBe(true);
    // ~3 km a nord e a est sono dentro, ~10 km no.
    expect(cells.has(cellKey(21, 39.025, CELL))).toBe(true);
    expect(cells.has(cellKey(21.03, 39, CELL))).toBe(true);
    expect(cells.has(cellKey(21, 39.09, CELL))).toBe(false);
  });

  it("densifies long segments so no gaps are left between vertices", () => {
    const cells = new Set(corridorCells([[21, 39], [21.5, 39]], 1, CELL));
    for (let lng = 21; lng <= 21.5; lng += CELL / 2) {
      expect(cells.has(cellKey(lng, 39, CELL))).toBe(true);
    }
  });

  it("returns sorted, unique keys", () => {
    const cells = corridorCells([[21, 39], [21, 39], [21.001, 39.001]], 2, CELL);
    expect(new Set(cells).size).toBe(cells.length);
    expect([...cells].sort()).toEqual(cells);
  });
});

describe("geometry helpers", () => {
  it("buffers a bbox by roughly the requested km", () => {
    const [w, s, e, n] = bufferBbox([21, 39, 21, 39], 11.132);
    expect(n - 39).toBeCloseTo(0.1, 5);
    expect(39 - s).toBeCloseTo(0.1, 5);
    // la longitudine si allarga di 1/cos(lat)
    expect(e - 21).toBeCloseTo(0.1 / Math.cos((39 * Math.PI) / 180), 4);
    expect(21 - w).toBeCloseTo(e - 21, 10);
  });

  it("converts to web mercator", () => {
    const m = bboxToMercator([-180, 0, 180, 0]);
    expect(m.minX).toBeCloseTo(-20037508.34, 1);
    expect(m.maxX).toBeCloseTo(20037508.34, 1);
    expect(m.minY).toBeCloseTo(0, 6);
  });

  it("turns cells into closed polygons", () => {
    const fc = cellsToGeoJson(["1050:1950"], CELL);
    const ring = fc.features[0].geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(ring[0][0]).toBeCloseTo(21, 10);
    expect(ring[0][1]).toBeCloseTo(39, 10);
  });
});
