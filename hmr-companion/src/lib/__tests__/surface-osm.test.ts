import { describe, expect, it } from "vitest";
import {
  classifyOsmHighwaySurface,
  dominantSurfaceAlongKm,
  mergeSurfaceSpans,
  medianSmoothKinds,
  surfaceKindAtKm,
} from "../surface-osm";

describe("classifyOsmHighwaySurface", () => {
  it("asphalt from major road", () => {
    expect(classifyOsmHighwaySurface({ highway: "primary" })).toBe("asphalt");
  });
  it("asphalt from surface", () => {
    expect(classifyOsmHighwaySurface({ highway: "unclassified", surface: "asphalt" })).toBe("asphalt");
  });
  it("gravel from track", () => {
    expect(classifyOsmHighwaySurface({ highway: "track", tracktype: "grade2" })).toBe("gravel");
  });
  it("single from path", () => {
    expect(classifyOsmHighwaySurface({ highway: "path" })).toBe("single");
  });
  it("single from steep track", () => {
    expect(classifyOsmHighwaySurface({ highway: "track", tracktype: "grade5" })).toBe("single");
  });
});

describe("mergeSurfaceSpans", () => {
  it("merges consecutive same kind", () => {
    const km = [0, 1, 2, 3];
    const kinds = ["gravel", "gravel", "asphalt", "asphalt"] as const;
    const spans = mergeSurfaceSpans(km, [...kinds], 10);
    expect(spans).toEqual([
      { km_start: 0, km_end: 2, surface: "gravel" },
      { km_start: 2, km_end: 10, surface: "asphalt" },
    ]);
  });
});

describe("surfaceKindAtKm / dominantSurfaceAlongKm", () => {
  const spans = [
    { km_start: 0, km_end: 10, surface: "gravel" as const },
    { km_start: 10, km_end: 20, surface: "asphalt" as const },
  ];
  it("finds span at km", () => {
    expect(surfaceKindAtKm(spans, 5)).toBe("gravel");
    expect(surfaceKindAtKm(spans, 15)).toBe("asphalt");
  });
  it("dominant along segment", () => {
    const biased = [
      { km_start: 0, km_end: 15, surface: "gravel" as const },
      { km_start: 15, km_end: 20, surface: "asphalt" as const },
    ];
    expect(dominantSurfaceAlongKm(biased, 0, 20, 10)).toBe("gravel");
  });
});

describe("medianSmoothKinds", () => {
  it("reduces isolated spike", () => {
    const k = ["gravel", "asphalt", "gravel"] as const;
    const s = medianSmoothKinds([...k], 3);
    expect(s[1]).toBe("gravel");
  });
});
