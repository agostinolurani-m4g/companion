import { describe, expect, it } from "vitest";
import { listBaseStyleOptions, resolveInitialStyleUrl } from "@/lib/map/topo-style";

describe("topo-style", () => {
  it("defaults to open free map style", () => {
    expect(resolveInitialStyleUrl("hike")).toContain("openfreemap");
  });

  it("includes topo in base options", () => {
    expect(listBaseStyleOptions()[0]).toBe("topo");
  });
});
