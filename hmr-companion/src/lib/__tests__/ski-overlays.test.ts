import { describe, expect, it } from "vitest";
import {
  buildSkiGeoJson,
  freeDrawCoords,
  parseSkiGeoJson,
  parseSkiWaypoints,
} from "../ski-overlays";

describe("ski-overlays", () => {
  it("builds FeatureCollection with ascent and descent", () => {
    const fc = buildSkiGeoJson(
      [
        [9.0, 46.0],
        [9.1, 46.1],
      ],
      [
        [9.1, 46.1],
        [9.0, 46.0],
      ],
    );
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    expect((fc.features[0].properties as { mode: string }).mode).toBe("ascent");
    expect((fc.features[1].properties as { mode: string }).mode).toBe("descent");
  });

  it("parses ski geojson roundtrip", () => {
    const fc = buildSkiGeoJson([[9, 46], [9.1, 46.1]], [[9.1, 46.1], [9, 46]]);
    const parsed = parseSkiGeoJson(fc);
    expect(parsed.ascentCoords).toHaveLength(2);
    expect(parsed.descentCoords).toHaveLength(2);
  });

  it("freeDrawCoords connects waypoints", () => {
    const coords = freeDrawCoords([
      { lng: 9, lat: 46 },
      { lng: 9.1, lat: 46.1 },
    ]);
    expect(coords).toEqual([
      [9, 46],
      [9.1, 46.1],
    ]);
  });

  it("parseSkiWaypoints handles structured payload", () => {
    const wp = parseSkiWaypoints({
      ascent: [[9, 46]],
      descent: [[9.1, 46.1]],
    });
    expect(wp.ascent).toHaveLength(1);
    expect(wp.descent).toHaveLength(1);
  });
});
