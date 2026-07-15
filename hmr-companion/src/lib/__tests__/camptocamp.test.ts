import { describe, expect, it } from "vitest";
import { mercator3857ToWgs84 } from "../camptocamp";

describe("camptocamp", () => {
  it("converts Web Mercator to WGS84", () => {
    const [lng, lat] = mercator3857ToWgs84(1_046_413, 5_876_000);
    expect(lng).toBeCloseTo(9.4, 0);
    expect(lat).toBeCloseTo(46.3, 0);
  });
});
