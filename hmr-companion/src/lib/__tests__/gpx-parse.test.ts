import { describe, expect, it } from "vitest";
import { parseGpx } from "../gpx-parse";

const SAMPLE_GPX = `<?xml version="1.0"?>
<gpx>
  <trk><name>Test Gita</name>
    <trkseg>
      <trkpt lat="46.3" lon="9.4"><ele>1200</ele></trkpt>
      <trkpt lat="46.31" lon="9.41"><ele>1500</ele></trkpt>
      <trkpt lat="46.32" lon="9.42"><ele>1800</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe("gpx-parse", () => {
  it("parses trkpt coordinates", () => {
    const r = parseGpx(SAMPLE_GPX);
    expect(r.name).toBe("Test Gita");
    expect(r.coordinates).toHaveLength(3);
    expect(r.coordinates[0]).toEqual([9.4, 46.3]);
    expect(r.length_km).toBeGreaterThan(0);
  });
});
