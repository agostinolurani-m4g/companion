import { describe, expect, it } from "vitest";
import {
  cumulativeKmAlong,
  elevationGainLoss,
  elevationGainLossSmoothed,
  haversineKm,
  nearestPointOnPolyline,
  positionAtKm,
} from "../track-geometry";

describe("track-geometry", () => {
  const line = [
    [21.0, 40.0],
    [21.0, 40.01],
    [21.01, 40.02],
    [21.02, 40.02],
  ] as [number, number][];

  it("haversine between two identical points is zero", () => {
    expect(haversineKm([0, 0], [0, 0])).toBe(0);
  });

  it("cumulative km along is monotonic and starts at zero", () => {
    const cum = cumulativeKmAlong(line);
    expect(cum[0]).toBe(0);
    for (let i = 1; i < cum.length; i++) {
      expect(cum[i]).toBeGreaterThan(cum[i - 1]);
    }
  });

  it("nearest projection of a point exactly on a vertex", () => {
    const res = nearestPointOnPolyline(line, line[1]);
    expect(res).not.toBeNull();
    expect(res!.distKm).toBeLessThan(0.001);
    const cum = cumulativeKmAlong(line);
    expect(Math.abs(res!.alongKm - cum[1])).toBeLessThan(0.001);
  });

  it("positionAtKm yields ends for out-of-range values", () => {
    const cum = cumulativeKmAlong(line);
    expect(positionAtKm(line, cum, -10)).toEqual(line[0]);
    const last = positionAtKm(line, cum, cum[cum.length - 1] + 10);
    expect(last[0]).toBe(line[line.length - 1][0]);
    expect(last[1]).toBe(line[line.length - 1][1]);
  });

  it("elevation gain/loss is correctly split", () => {
    const { gain, loss } = elevationGainLoss([100, 120, 110, 150, 140]);
    expect(gain).toBe(60);
    expect(loss).toBe(20);
  });

  it("smoothed elevation gain ignores sub-threshold noise", () => {
    const noisy = [100, 101, 99, 101, 100, 102, 99, 101, 100];
    const raw = elevationGainLoss(noisy);
    const smooth = elevationGainLossSmoothed(noisy, {
      windowPts: 3,
      thresholdM: 3,
    });
    expect(raw.gain).toBeGreaterThan(0);
    expect(smooth.gain).toBe(0);
    expect(smooth.loss).toBe(0);
  });

  it("smoothed elevation gain preserves a real climb above threshold", () => {
    const climb = Array.from({ length: 50 }, (_, i) => 100 + i * 2);
    const { gain, loss } = elevationGainLossSmoothed(climb, {
      windowPts: 5,
      thresholdM: 3,
    });
    expect(gain).toBeGreaterThan(90);
    expect(gain).toBeLessThanOrEqual(98);
    expect(loss).toBe(0);
  });
});
