import { describe, expect, it } from "vitest";
import { bestMaxZoom, estimateArea, OFFLINE_MAX_TILES, offlineUrls, tileRange } from "@/lib/offline/area";

// Valchiavenna, ~20 × 20 km.
const AREA = { south: 46.25, west: 9.3, north: 46.43, east: 9.56 };

describe("aree offline", () => {
  it("intervallo di tile coerente con lo zoom", () => {
    const z10 = tileRange(AREA, 10);
    const z14 = tileRange(AREA, 14);
    expect(z10.count).toBeGreaterThanOrEqual(1);
    expect(z14.count).toBeGreaterThan(z10.count * 20);
  });

  it("stima e zoom massimo dentro il limite", () => {
    const est = estimateArea(AREA);
    expect(est.tiles).toBeGreaterThan(100);
    expect(est.bytes).toBeGreaterThan(1_000_000);
    expect(bestMaxZoom(AREA)).toBe(14);
    const alps = { south: 45.5, west: 6.5, north: 47.5, east: 11.5 };
    const z = bestMaxZoom(alps);
    expect(z).toBeLessThan(14);
    expect(estimateArea(alps, z).tiles).toBeLessThanOrEqual(OFFLINE_MAX_TILES);
  });

  it("URL: tilejson, vettoriali, DEM e font", () => {
    const urls = offlineUrls(AREA, 12, "https://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf");
    expect(urls[0]).toBe("https://tiles.openfreemap.org/planet");
    expect(urls.some((u) => u.startsWith("https://tiles.openfreemap.org/planet/v1/12/"))).toBe(true);
    expect(urls.some((u) => u.startsWith("https://tiles.mapterhorn.com/12/"))).toBe(true);
    expect(urls.some((u) => u.includes("/fonts/Noto%20Sans%20Regular/0-255.pbf"))).toBe(true);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
