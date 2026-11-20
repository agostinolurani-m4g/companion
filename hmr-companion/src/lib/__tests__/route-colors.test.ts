import { describe, expect, it } from "vitest";
import {
  adaptLineColors,
  contrastRatio,
  LIGHT_MAP_SAMPLES,
  mapLineColor,
  minLightContrast,
  MIN_CONTRAST,
} from "@/lib/map/route-colors";
import { SWISS } from "@/lib/map/swiss-style";
import { SPORTS } from "@/lib/sports";

/** Croma approssimata in sRGB (max - min dei canali, 0–1). */
function saturation(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

describe("mapLineColor", () => {
  it("keeps colors unchanged on dark basemaps", () => {
    expect(mapLineColor("#7fb8ae", true)).toBe("#7fb8ae");
  });

  it("uses the basemap paper and forest as contrast samples", () => {
    expect(LIGHT_MAP_SAMPLES).toContain(SWISS.paper);
    expect(LIGHT_MAP_SAMPLES).toContain(SWISS.forest);
  });

  it("makes every pastel sport color readable on paper and forest of the light topo map", () => {
    for (const sport of Object.values(SPORTS)) {
      expect(minLightContrast(mapLineColor(sport.color, false))).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("turns pastels into vivid colors instead of muddy dark ones", () => {
    for (const c of ["#7fb8ae", "#ad9fdb", "#9ebfd8", "#cdb68f"]) {
      // +0.1 minimo: il petrolio scuro ha poca croma disponibile in sRGB, gli altri salgono di più.
      expect(saturation(mapLineColor(c, false))).toBeGreaterThan(saturation(c) + 0.1);
    }
  });

  it("does not over-darken: result stays well above near-black", () => {
    const out = mapLineColor("#9ebfd8", false);
    expect(contrastRatio(out, "#000000")).toBeGreaterThan(2.5);
  });

  it("leaves already-dark colors and non-hex values alone", () => {
    expect(mapLineColor("#1d4ed8", false)).toBe("#1d4ed8");
    expect(mapLineColor("rgb(1,2,3)", false)).toBe("rgb(1,2,3)");
  });
});

describe("adaptLineColors", () => {
  it("adapts existing colors and fills missing ones with the fallback", () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { color: "#7fb8ae", idx: 1 }, geometry: { type: "Point", coordinates: [0, 0] } },
        { type: "Feature", properties: { dashed: true }, geometry: { type: "Point", coordinates: [0, 0] } },
      ],
    };
    const out = adaptLineColors(fc, false, "#8f7fd1");
    expect(out.features[0].properties?.idx).toBe(1);
    expect(out.features[0].properties?.color).toBe(mapLineColor("#7fb8ae", false));
    expect(out.features[1].properties?.dashed).toBe(true);
    expect(out.features[1].properties?.color).toBe(mapLineColor("#8f7fd1", false));
  });
});
