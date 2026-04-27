import { describe, expect, it } from "vitest";
import { computeEta, estimateHoursBetween, DEFAULT_PACE } from "../pace";
import type { StoredCoord } from "../track-coords";

const mockCoords: StoredCoord[] = [
  [21, 40, 500, 0],
  [21, 40.01, 600, 1],
  [21, 40.02, 650, 2],
  [21, 40.03, 700, 3],
  [21, 40.04, 900, 4],
  [21, 40.05, 900, 5],
];

describe("pace", () => {
  it("estimate positive hours for a real segment", () => {
    const h = estimateHoursBetween(mockCoords, 0, 5, DEFAULT_PACE);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(10);
  });

  it("ETA status red when cutoff is in the past", () => {
    const now = Date.parse("2026-05-25T10:00:00Z");
    const eta = computeEta(mockCoords, 0, 5, DEFAULT_PACE, now - 1_000_000, now);
    expect(eta.cutoffStatus).toBe("red");
  });

  it("ETA status green when plenty of margin", () => {
    const now = Date.parse("2026-05-25T10:00:00Z");
    const cutoff = now + 1000 * 3600 * 100;
    const eta = computeEta(mockCoords, 0, 5, DEFAULT_PACE, cutoff, now);
    expect(eta.cutoffStatus).toBe("green");
    expect(eta.marginHours).toBeGreaterThan(2);
  });
});
