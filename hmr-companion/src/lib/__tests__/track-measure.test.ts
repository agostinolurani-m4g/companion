import { describe, expect, it } from "vitest";
import type { StoredCoord } from "../track-coords";
import { elevationGainLoss, elevationGainLossSmoothed } from "../track-geometry";
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

  it("measureBetween gain/loss match global raw profile when track is short (n < window)", () => {
    const raw = elevationGainLoss(coords.map((c) => c[2]!));
    const m = measureBetween(coords, 0, 4);
    expect(m.gainM).toBeCloseTo(raw.gain, 5);
    expect(m.lossM).toBeCloseTo(raw.loss, 5);
  });

  it("measureBetween is additive for any split km (raw short track)", () => {
    const total = measureBetween(coords, 0, 4);
    for (const mid of [0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
      const ab = measureBetween(coords, 0, mid);
      const bc = measureBetween(coords, mid, 4);
      expect(ab.gainM + bc.gainM).toBeCloseTo(total.gainM, 6);
      expect(ab.lossM + bc.lossM).toBeCloseTo(total.lossM, 6);
    }
  });

  /**
   * Profilo lungo + smoothing: prima della correzione A→C poteva differire da
   * A→B + B→C (finestra mobile / hysteresis reset su sotto-profilo).
   */
  it("measureBetween is additive on smoothed track (n >= window)", () => {
    const n = 38;
    const coordsLong: StoredCoord[] = [];
    for (let i = 0; i < n; i++) {
      const zig = i >= 14 && i <= 24 ? (i % 3 === 0 ? 4 : i % 3 === 1 ? -2 : 1) : 0;
      const elev = 1000 + i * 22 + zig;
      coordsLong.push([11, 46 + i * 0.001, elev, i]);
    }
    const endKm = n - 1;
    const total = measureBetween(coordsLong, 0, endKm);
    const global = elevationGainLossSmoothed(coordsLong.map((c) => c[2]!), {
      windowPts: 15,
      thresholdM: 3,
    });
    expect(total.gainM).toBeCloseTo(global.gain, 4);
    expect(total.lossM).toBeCloseTo(global.loss, 4);

    const mids = [2.25, 6.1, 11.7, 18.4, 23.8, 29.5, 34.2];
    for (const mid of mids) {
      const ab = measureBetween(coordsLong, 0, mid);
      const bc = measureBetween(coordsLong, mid, endKm);
      expect(ab.gainM + bc.gainM).toBeCloseTo(total.gainM, 5);
      expect(ab.lossM + bc.lossM).toBeCloseTo(total.lossM, 5);
    }
  });

  /** Discesa cumulata nota: rampa lineare 0→1600 m su 16 km (raw, n < 15). */
  it("known monotonic descent: 1600 m loss over 16 km", () => {
    const ramp: StoredCoord[] = [];
    for (let i = 0; i <= 12; i++) {
      ramp.push([11, 46 + i * 0.001, 1600 - i * (1600 / 12), i]);
    }
    const m = measureBetween(ramp, 0, 12);
    expect(m.lossM).toBeCloseTo(1600, 3);
    expect(m.gainM).toBe(0);
    const mid = 6.5;
    const ab = measureBetween(ramp, 0, mid);
    const bc = measureBetween(ramp, mid, 12);
    expect(ab.lossM + bc.lossM).toBeCloseTo(1600, 3);
  });
});
