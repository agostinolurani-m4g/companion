import { describe, expect, it } from "vitest";
import type { StoredCoord } from "../track-coords";
import {
  coordAtKm,
  measureBetween,
  polylineBetween,
  projectLngLatToTrack,
} from "../track-measure";

const coords: StoredCoord[] = [
  [11.0, 46.0, 1000, 0],
  [11.0, 46.01, 1100, 1],
  [11.0, 46.02, 1050, 2],
  [11.0, 46.03, 1200, 3],
  [11.0, 46.04, 900, 4],
];

describe("track-measure", () => {
  it("coordAtKm interpolates between vertices", () => {
    const p = coordAtKm(coords, 1.5);
    expect(p).not.toBeNull();
    expect(p!.lat).toBeCloseTo(46.015, 4);
    expect(p!.elev).toBeCloseTo(1075, 4);
  });

  it("coordAtKm clamps to endpoints", () => {
    expect(coordAtKm(coords, -5)?.lat).toBeCloseTo(46.0, 6);
    expect(coordAtKm(coords, 999)?.lat).toBeCloseTo(46.04, 6);
  });

  it("projectLngLatToTrack snaps a point to the nearest segment", () => {
    const p = projectLngLatToTrack(coords, 11.0001, 46.015);
    expect(p).not.toBeNull();
    expect(p!.alongKm).toBeCloseTo(1.5, 2);
    expect(p!.distKm).toBeGreaterThanOrEqual(0);
  });

  it("measureBetween computes distance, gain and loss", () => {
    const m = measureBetween(coords, 0, 4);
    expect(m.distKm).toBeCloseTo(4, 6);
    expect(m.gainM).toBeCloseTo(100 + 150, 3);
    expect(m.lossM).toBeCloseTo(50 + 300, 3);
    expect(m.elevA).toBeCloseTo(1000, 3);
    expect(m.elevB).toBeCloseTo(900, 3);
  });

  it("measureBetween is symmetric", () => {
    const a = measureBetween(coords, 1, 3);
    const b = measureBetween(coords, 3, 1);
    expect(a.distKm).toBeCloseTo(b.distKm, 6);
    expect(a.gainM).toBeCloseTo(b.gainM, 6);
    expect(a.lossM).toBeCloseTo(b.lossM, 6);
  });

  it("measureBetween applies profile gain/loss scale", () => {
    const m = measureBetween(coords, 0, 4, {
      profileGainScale: 2,
      profileLossScale: 0.5,
    });
    const base = measureBetween(coords, 0, 4);
    expect(m.gainM).toBeCloseTo(base.gainM * 2, 6);
    expect(m.lossM).toBeCloseTo(base.lossM * 0.5, 6);
  });

  it("polylineBetween includes interpolated endpoints", () => {
    const poly = polylineBetween(coords, 0.5, 2.5);
    expect(poly.length).toBeGreaterThanOrEqual(3);
    expect(poly[0][1]).toBeCloseTo(46.005, 4);
    expect(poly[poly.length - 1][1]).toBeCloseTo(46.025, 4);
  });
});
