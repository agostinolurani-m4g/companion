import { describe, expect, it } from "vitest";
import {
  emptyActivityCounts,
  isUserRouteActivity,
  SPORTS,
  USER_ROUTE_ACTIVITIES,
} from "@/lib/sports";

describe("sports registry", () => {
  it("has fourteen activities, each with a definition", () => {
    expect(USER_ROUTE_ACTIVITIES).toHaveLength(14);
    for (const a of USER_ROUTE_ACTIVITIES) expect(SPORTS[a].id).toBe(a);
    for (const id of USER_ROUTE_ACTIVITIES) {
      expect(SPORTS[id].id).toBe(id);
    }
  });

  it("validates activity ids", () => {
    expect(isUserRouteActivity("trail_run")).toBe(true);
    expect(isUserRouteActivity("invalid")).toBe(false);
  });

  it("empty activity counts zeroes all keys", () => {
    const counts = emptyActivityCounts();
    expect(Object.keys(counts)).toHaveLength(USER_ROUTE_ACTIVITIES.length);
    expect(counts.ski).toBe(0);
    expect(counts.ferrata).toBe(0);
  });
});
