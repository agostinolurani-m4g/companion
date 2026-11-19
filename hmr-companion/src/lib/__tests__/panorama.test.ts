import { describe, expect, it } from "vitest";
import { bearingDeg, computePanorama, declutterPeaks, distanceM, type ElevationSampler } from "@/lib/panorama";

const O = { lng: 9.0, lat: 46.0 };
const KM_LAT = 1 / 111.32;
const KM_LNG = 1 / (111.32 * Math.cos((46 * Math.PI) / 180));

/** Pianura a 500 m con coni (raggio 3 km) nelle posizioni date. */
function cones(list: { lng: number; lat: number; h: number }[]): ElevationSampler {
  return (lng, lat) => {
    let e = 500;
    for (const c of list) {
      const d = distanceM(c.lng, c.lat, lng, lat);
      e = Math.max(e, 500 + c.h * Math.max(0, 1 - d / 3000));
    }
    return e;
  };
}

const NORTH_BIG = { lng: O.lng, lat: O.lat + 10 * KM_LAT, h: 2000 };
const NORTH_HIDDEN = { lng: O.lng, lat: O.lat + 20 * KM_LAT, h: 1000 };
const EAST = { lng: O.lng + 15 * KM_LNG, lat: O.lat, h: 1500 };

describe("panorama", () => {
  const sampler = cones([NORTH_BIG, NORTH_HIDDEN, EAST]);
  const peaks = [
    { id: "a", name: "Grande", lng: NORTH_BIG.lng, lat: NORTH_BIG.lat, ele: 2500 },
    { id: "b", name: "Nascosta", lng: NORTH_HIDDEN.lng, lat: NORTH_HIDDEN.lat, ele: 1500 },
    { id: "c", name: "Est", lng: EAST.lng, lat: EAST.lat, ele: 2000 },
  ];

  it("orizzonte alto verso la montagna, piatto altrove", () => {
    const p = computePanorama(sampler, O, peaks, { maxDistanceM: 40_000, stepDeg: 1 })!;
    expect(p.observer.ele).toBe(500);
    // atan(2000-2 / 10000) ≈ 11.3°
    expect(p.horizon[0]).toBeGreaterThan(10.5);
    expect(p.horizon[0]).toBeLessThan(11.6);
    expect(p.horizon[90]).toBeGreaterThan(4);
    expect(p.horizon[225]).toBeLessThan(0.1);
  });

  it("vette visibili e coperte", () => {
    const p = computePanorama(sampler, O, peaks, { maxDistanceM: 40_000, stepDeg: 1 })!;
    expect(p.peaks.map((x) => x.name)).toEqual(["Grande", "Est"]);
    expect(p.peaks[1].azimuth).toBeCloseTo(90, 0);
  });

  it("declutter tiene la più importante fra vicine", () => {
    const p = computePanorama(sampler, O, peaks, { maxDistanceM: 40_000, stepDeg: 1 })!;
    const twin = { ...p.peaks[0], id: "x", name: "Anticima", azimuth: 1, ele_used: 2300, angle: 9 };
    expect(declutterPeaks([...p.peaks, twin], 3).map((x) => x.name)).toEqual(["Grande", "Est"]);
  });

  it("bearing", () => {
    expect(bearingDeg(9, 46, 9, 46.1)).toBeCloseTo(0, 3);
    expect(bearingDeg(9, 46, 9.1, 46)).toBeCloseTo(90, 3);
  });
});
