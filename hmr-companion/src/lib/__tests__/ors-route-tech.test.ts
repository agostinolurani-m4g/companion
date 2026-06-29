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
