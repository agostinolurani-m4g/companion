import { describe, expect, it } from "vitest";
import { parseExploreScope } from "../ski-explore";
import { buildRouteMarkersGeoJsonFromTracks, routeEndpointsFromSkiGeojson } from "../ski-overlays";

describe("ski-explore scope", () => {
  it("parses public and mine", () => {
    expect(parseExploreScope("public")).toBe("public");
    expect(parseExploreScope("mine")).toBe("mine");
  });

  it("parses group scope", () => {
    expect(parseExploreScope("group:abc-123")).toBe("group:abc-123");
    expect(parseExploreScope("group:")).toBeNull();
  });
});

describe("buildRouteMarkersGeoJsonFromTracks", () => {
  it("includes summit when ascent and descent present", () => {
    const fc = buildRouteMarkersGeoJsonFromTracks(
      [
        [9, 46],
        [9.01, 46.02],
      ],
      [
        [9.01, 46.02],
        [9, 46],
      ],
    );
    const kinds = fc.features.map((f) => (f.properties as { kind: string }).kind);
    expect(kinds).toContain("start");
    expect(kinds).toContain("summit");
    expect(kinds).not.toContain("end");
  });

  it("infers summit on single camptocamp-like track from D+/D-", () => {
    const fc = buildRouteMarkersGeoJsonFromTracks(
      [
        [9, 46],
        [9.005, 46.01],
        [9.01, 46.02],
        [9.005, 46.01],
        [9, 46],
      ],
      null,
      { elevGainM: 1000, elevLossM: 1000 },
    );
    const kinds = fc.features.map((f) => (f.properties as { kind: string }).kind);
    expect(kinds).toContain("summit");
  });
});
