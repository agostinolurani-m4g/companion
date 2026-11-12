import { describe, expect, it } from "vitest";
import { estimateDurationMin, formatDuration } from "@/lib/route-time";

describe("estimateDurationMin", () => {
  it("applies DIN 33466 for hiking (12 km, +900, -900)", () => {
    // horiz = 3 h, vert = 3 + 1.8 = 4.8 h → 4.8 + 1.5 = 6.3 h
    expect(estimateDurationMin("hike", 12, 900, 900)).toBe(378);
  });

  it("is zero for empty routes", () => {
    expect(estimateDurationMin("hike", 0, 0, 0)).toBe(0);
  });

  it("uses flat speed plus climb penalty for bikes", () => {
    // 50 km / 25 + 750 / 750 = 3 h
    expect(estimateDurationMin("road", 50, 750, 750)).toBe(180);
  });

  it("makes trail running faster than hiking", () => {
    expect(estimateDurationMin("trail_run", 20, 1200, 1200)).toBeLessThan(estimateDurationMin("hike", 20, 1200, 1200));
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(205)).toBe("3 h 25");
    expect(formatDuration(0)).toBe("—");
  });
});
