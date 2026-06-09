import { describe, expect, it } from "vitest";
import { filterRecordedPoint } from "@/lib/activity-points";
import { recordedPointsToGpx, parseGpxTrackpoints } from "@/lib/gpx";
import { ingestPositionsToDb } from "@/lib/track-ingest";
import { getDb, resetDbConnection } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("activity ingest", () => {
  it("filters inaccurate GPS points", () => {
    expect(
      filterRecordedPoint(
        { lat: 45, lng: 7, ts: 1, accuracyM: 100 },
        null
      )
    ).toBe(false);
    expect(
      filterRecordedPoint({ lat: 45, lng: 7, ts: 1, accuracyM: 10 }, null)
    ).toBe(true);
  });

  it("round-trips recordedPointsToGpx", () => {
    const gpx = recordedPointsToGpx("Test", [
      { lat: 45.1, lng: 7.2, eleM: 1200, ts: Date.now() },
      { lat: 45.11, lng: 7.21, ts: Date.now() + 1000 },
    ]);
    const pts = parseGpxTrackpoints(gpx);
    expect(pts.length).toBe(2);
    expect(pts[0]!.lat).toBeCloseTo(45.1, 4);
  });

  it("ingestPositionsToDb creates gps_record track", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-test-"));
    process.env.PERSONAL_DB_PATH = path.join(tmp, "test.db");
    resetDbConnection();

    const result = ingestPositionsToDb({
      positions: [
        [7.0, 45.0, 1000],
        [7.01, 45.01, 1050],
        [7.02, 45.02, 1100],
      ],
      trackId: "gps-test",
      name: "GPS Test",
      ownerId: "ago",
      source: "gps_record",
    });

    expect(result.length_km).toBeGreaterThan(0);
    const row = getDb()
      .prepare(`SELECT source FROM tracks WHERE id = ?`)
      .get("gps-test") as { source: string };
    expect(row.source).toBe("gps_record");

    delete process.env.PERSONAL_DB_PATH;
    resetDbConnection();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
