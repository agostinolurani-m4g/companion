import { describe, expect, it } from "vitest";
import { parseOrsExtras } from "@/lib/ors-route-tech";

describe("parseOrsExtras", () => {
  const coords: [number, number][] = [
    [9.39, 46.31],
    [9.395, 46.315],
    [9.4, 46.32],
    [9.405, 46.325],
  ];

  it("maps surface and waytype codes to track kinds", () => {
    const tech = parseOrsExtras(coords, {
      surface: { values: [[0, 1, 3], [2, 3, 10]] },
      waytype: { values: [[0, 1, 3], [2, 3, 5]] },
      steepness: { values: [[0, 3, 4]] },
      traildifficulty: { values: [[0, 3, 3]] },
    });
    expect(tech.segments.length).toBeGreaterThan(0);
    expect(tech.summary.surface_pct.asphalt).toBeGreaterThan(0);
    expect(tech.summary.max_steepness).toBe("Salita ripida");
    expect(tech.summary.max_difficulty).toBe("T3");
    expect(tech.colored_segments.length).toBeGreaterThan(0);
    expect(tech.surface_bands.length).toBeGreaterThan(0);
  });

  it("returns unknown fallback without extras", () => {
    const tech = parseOrsExtras(coords, undefined);
    expect(tech.summary.surface_pct.unknown).toBe(100);
    expect(tech.colored_segments[0]?.surface).toBe("unknown");
  });
});

describe("parseOrsExtras – categorie e intervalli", () => {
  const coords: [number, number][] = [
    [9.39, 46.31],
    [9.395, 46.315],
    [9.4, 46.32],
    [9.405, 46.325],
    [9.41, 46.33],
  ];

  it("does not double count km when extras have different breakpoints", () => {
    const tech = parseOrsExtras(coords, {
      surface: { values: [[0, 4, 1]] },
      waytype: { values: [[0, 2, 6], [2, 4, 4]] },
      steepness: { values: [[0, 1, 1], [1, 4, 2]] },
    });
    const segKm = tech.segments.reduce((s, x) => s + (x.toKm - x.fromKm), 0);
    const total = tech.segments[tech.segments.length - 1]!.toKm;
    expect(segKm).toBeCloseTo(total, 6);
    const cat = tech.summary.category_km ?? {};
    expect((cat.cycleway ?? 0) + (cat.trail ?? 0)).toBeCloseTo(total, 6);
    expect(cat.cycleway).toBeGreaterThan(0);
    expect(cat.trail).toBeGreaterThan(0);
    expect(tech.category_segments?.length).toBe(2);
  });
});
