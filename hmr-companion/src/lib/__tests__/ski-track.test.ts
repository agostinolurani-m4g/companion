import { describe, expect, it } from "vitest";
import {
  buildTrackFromWaypoints,
  findSteepSegments,
  gradesAlongProfile,
  SKI_MAX_WAYPOINT_GAP_KM,
  validateWaypointGap,
} from "../ski-track";

describe("ski-track", () => {
  it("rejects waypoint gap over 1 km", () => {
    const r = validateWaypointGap({ lng: 9, lat: 46 }, { lng: 9.02, lat: 46.02 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.maxGapKm).toBe(SKI_MAX_WAYPOINT_GAP_KM);
  });

  it("accepts waypoint gap under 1 km", () => {
    const r = validateWaypointGap({ lng: 9, lat: 46 }, { lng: 9.004, lat: 46.004 });
    expect(r.ok).toBe(true);
  });

  it("densifies track every ~50m", () => {
    const wps = [
      { lng: 9.0, lat: 46.0 },
      { lng: 9.001, lat: 46.0 },
    ];
    const coords = buildTrackFromWaypoints(wps, 50);
    expect(coords.length).toBeGreaterThan(2);
  });

  it("detects steep segment from profile", () => {
    const distanceKm = [0, 0.05, 0.1, 0.15];
    const elevationM = [1000, 1030, 1060, 1065];
    const grades = gradesAlongProfile(distanceKm, elevationM);
    expect(grades[0].gradePct).toBeGreaterThan(50);
    const steep = findSteepSegments(distanceKm, elevationM);
    expect(steep.length).toBeGreaterThan(0);
  });
});
