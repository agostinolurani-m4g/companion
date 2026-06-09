import { describe, expect, it } from "vitest";
import { computeSteepUnpavedSpans } from "@/lib/difficulty-steep";
import type { StoredCoord } from "@/lib/track-coords";

describe("computeSteepUnpavedSpans", () => {
  it("detects steep unpaved segment", () => {
    const coords: StoredCoord[] = [
      [7.0, 45.0, 1000, 0],
      [7.001, 45.0, 1100, 0.08],
    ];
    const spans = computeSteepUnpavedSpans(coords, [], 15, 40);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]!.grade_pct_max).toBeGreaterThanOrEqual(15);
  });

  it("ignores short segments", () => {
    const coords: StoredCoord[] = [
      [7.0, 45.0, 1000, 0],
      [7.00001, 45.0, 1050, 0.001],
    ];
    const spans = computeSteepUnpavedSpans(coords, [], 15, 40);
    expect(spans.length).toBe(0);
  });
});
