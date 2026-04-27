import { describe, expect, it } from "vitest";
import {
  applySurfaceKmOverride,
  fragmentsOutsideRange,
} from "../surface-segment-merge";

describe("fragmentsOutsideRange", () => {
  it("ritorna il segmento intero se non c’è sovrapposizione", () => {
    const s = {
      km_start: 8,
      km_end: 12,
      surface: "gravel" as const,
      source: "osm_overpass",
    };
    expect(fragmentsOutsideRange(s, 0, 5)).toEqual([s]);
  });

  it("taglia al centro lasciando due pezzi", () => {
    const s = {
      km_start: 0,
      km_end: 10,
      surface: "gravel" as const,
      source: "osm_overpass",
    };
    const f = fragmentsOutsideRange(s, 3, 7);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ km_start: 0, km_end: 3, surface: "gravel" });
    expect(f[1]).toMatchObject({ km_start: 7, km_end: 10, surface: "gravel" });
  });
});

describe("applySurfaceKmOverride", () => {
  it("con DB vuoto inserisce solo il tratto utente", () => {
    const out = applySurfaceKmOverride([], 10, 20, "asphalt");
    expect(out).toEqual([
      { km_start: 10, km_end: 20, surface: "asphalt", source: "user_manual" },
    ]);
  });

  it("sostituisce il centro di un segmento OSM", () => {
    const existing = [
      { km_start: 0, km_end: 30, surface: "gravel" as const, source: "osm_overpass" },
    ];
    const out = applySurfaceKmOverride(existing, 10, 20, "asphalt");
    const asphalt = out.find((x) => x.surface === "asphalt");
    expect(asphalt).toMatchObject({ km_start: 10, km_end: 20, source: "user_manual" });
    const gravelKm = out
      .filter((x) => x.surface === "gravel")
      .reduce((a, x) => a + (x.km_end - x.km_start), 0);
    expect(gravelKm).toBeCloseTo(20, 5);
  });
});
