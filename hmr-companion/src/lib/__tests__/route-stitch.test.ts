import { describe, expect, it } from "vitest";
import { gainLossWithHysteresis, stitchWays } from "@/lib/route-stitch";

describe("stitchWays", () => {
  it("joins unordered and reversed members into one chain", () => {
    const a: [number, number][] = [
      [9.0, 46.0],
      [9.001, 46.0],
    ];
    const b: [number, number][] = [
      [9.002, 46.0],
      [9.001, 46.0],
    ]; // reversed
    const c: [number, number][] = [
      [9.002, 46.0],
      [9.003, 46.0],
    ];
    const r = stitchWays([c, a, b])!;
    expect(r.chains).toBe(1);
    expect(r.line).toHaveLength(4);
    const xs = r.line.map((p) => p[0]);
    const sorted = [...xs].sort((x, y) => x - y);
    expect(xs.join() === sorted.join() || xs.join() === sorted.reverse().join()).toBe(true);
    expect(r.coverage).toBeCloseTo(1, 5);
  });

  it("keeps the longest chain when members are disconnected", () => {
    const long: [number, number][] = [
      [9.0, 46.0],
      [9.01, 46.0],
    ];
    const short: [number, number][] = [
      [9.5, 46.5],
      [9.501, 46.5],
    ];
    const r = stitchWays([short, long])!;
    expect(r.chains).toBe(2);
    expect(r.line[0]![0]).toBe(9.0);
    expect(r.coverage).toBeGreaterThan(0.85);
  });
});

describe("gainLossWithHysteresis", () => {
  it("ignores small noise", () => {
    expect(gainLossWithHysteresis([100, 102, 99, 101, 100])).toEqual({ gain: 0, loss: 0 });
  });
  it("sums real climbs and descents", () => {
    expect(gainLossWithHysteresis([100, 150, 140, 200, 120])).toEqual({ gain: 110, loss: 90 });
  });
});
