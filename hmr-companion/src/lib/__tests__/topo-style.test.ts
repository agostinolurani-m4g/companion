import { describe, expect, it } from "vitest";
import {
  DEM_ATTRIBUTION,
  DEM_MAXZOOM,
  DEM_TILE_SIZE,
  listBaseStyleOptions,
  OPEN_DEM_TILES,
  resolveInitialStyleUrl,
} from "@/lib/map/topo-style";

describe("topo-style", () => {
  it("uses the Mapterhorn terrarium DEM", () => {
    expect(OPEN_DEM_TILES).toBe("https://tiles.mapterhorn.com/{z}/{x}/{y}.webp");
    expect(DEM_TILE_SIZE).toBe(512);
    // z13+ esiste solo nelle aree lidar (404 in Grecia): il maxzoom globale resta 12.
    expect(DEM_MAXZOOM).toBe(12);
    expect(DEM_ATTRIBUTION).toContain("mapterhorn.com/attribution");
    expect(DEM_ATTRIBUTION).not.toMatch(/mapzen/i);
  });

  it("defaults to open free map style", () => {
    expect(resolveInitialStyleUrl("hike")).toContain("openfreemap");
  });

  it("includes topo in base options", () => {
    expect(listBaseStyleOptions()[0]).toBe("topo");
  });
});
