import { describe, expect, it } from "vitest";
import { decodeTerrarium, lngLatToPixel } from "@/lib/dem-sample";

describe("dem-sample", () => {
  it("decodes terrarium RGB to metres", () => {
    // 32768 + 1000 m → R=131, G=232, B=0
    expect(decodeTerrarium(131, 232, 0)).toBe(1000);
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
  });

  it("maps lng/lat to the expected z13 tile (Chiavenna)", () => {
    const { px, py } = lngLatToPixel(9.4, 46.32, 13);
    expect(Math.floor(px / 256)).toBe(4309);
    expect(Math.floor(py / 256)).toBe(2903);
  });
});
