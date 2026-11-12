import { describe, expect, it } from "vitest";
import { classifyRouteShape } from "@/lib/route-shape";
import { aggregateWayFacts, overpassGeomLengthM, routeQuality } from "@/lib/osm-way-facts";

type Pt = [number, number];
const line = (from: Pt, to: Pt, n = 20): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n] as Pt);

describe("classifyRouteShape", () => {
  it("traverse when start and end are far apart", () => {
    expect(classifyRouteShape(line([9, 46], [9.05, 46.02]))).toBe("traversata");
  });
  it("out-and-back when the return retraces the outward leg", () => {
    const out = line([9, 46], [9.03, 46.01]);
    expect(classifyRouteShape([...out, ...out.slice().reverse().slice(1)])).toBe("andata_ritorno");
  });
  it("loop when it comes back by another way", () => {
    const loop = [...line([9, 46], [9.02, 46]), ...line([9.02, 46], [9.02, 46.02]).slice(1), ...line([9.02, 46.02], [9, 46.02]).slice(1), ...line([9, 46.02], [9, 46]).slice(1)];
    expect(classifyRouteShape(loop)).toBe("anello");
  });
  it("null for degenerate input", () => {
    expect(classifyRouteShape([[9, 46]])).toBeNull();
  });
});

describe("aggregateWayFacts", () => {
  it("computes sac max/prevalent by length, surface and equipped sections", () => {
    const f = aggregateWayFacts([
      { lengthM: 3000, tags: { sac_scale: "mountain_hiking", surface: "ground" } },
      { lengthM: 500, tags: { sac_scale: "alpine_hiking", surface: "rock", safety_rope: "yes" } },
      { lengthM: 1000, tags: { surface: "asphalt" } },
      { lengthM: 200, tags: { highway: "via_ferrata", "mtb:scale": "3" } },
    ]);
    expect(f.sac_max).toBe("T4");
    expect(f.sac_prevalent).toBe("T2");
    expect(f.sac_share).toBeCloseTo(3500 / 4700, 2);
    expect(f.surface).toBe("ground");
    expect(f.paved_share).toBeCloseTo(1000 / 4500, 2);
    expect(f.equipped_m).toBe(700);
    expect(f.mtb_scale_max).toBe("3");
    expect(f.ways).toBe(4);
  });
  it("empty input", () => {
    expect(aggregateWayFacts([])).toMatchObject({ sac_max: null, sac_prevalent: null, surface: null, paved_share: null, equipped_m: 0 });
  });
  it("overpass geometry length", () => {
    expect(overpassGeomLengthM([{ lat: 46, lon: 9 }, null, { lat: 46.01, lon: 9 }])).toBeCloseTo(1105, -1);
  });
});

describe("routeQuality", () => {
  it("full relation of decent length scores 1", () => {
    expect(routeQuality({ length_km: 10, coverage: 1, chains: 1, hasName: true })).toBe(1);
  });
  it("short fragments and partial relations are demoted", () => {
    expect(routeQuality({ length_km: 1.2, coverage: 1 })).toBeLessThan(0.6);
    expect(routeQuality({ length_km: 10, coverage: 0.65 })).toBeLessThan(0.7);
    expect(routeQuality({ length_km: 0.9, coverage: 0.6, chains: 5 })).toBeLessThan(0.2);
  });
});
