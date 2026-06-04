import { describe, expect, it } from "vitest";
import { parseGpxTrackpoints } from "../gpx";
import {
  displayNameFromGpxFilename,
  resolveUniqueTrackId,
  slugifyTrackId,
} from "../track-ingest";

const MINI_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk><name>Test</name><trkseg>
    <trkpt lat="45.0" lon="9.0"><ele>100</ele></trkpt>
    <trkpt lat="45.001" lon="9.001"><ele>110</ele></trkpt>
    <trkpt lat="45.002" lon="9.002"><ele>105</ele></trkpt>
  </trkseg></trk>
</gpx>`;

describe("slugifyTrackId", () => {
  it("normalizza nome gara", () => {
    expect(slugifyTrackId("Hellenic Mountain Race 2026")).toBe("hellenic-mountain-race-2026");
  });

  it("gestisce stringa vuota", () => {
    expect(slugifyTrackId("   ")).toBe("track");
  });
});

describe("resolveUniqueTrackId", () => {
  it("ritorna id base se libero", () => {
    expect(resolveUniqueTrackId("My Race", () => false)).toBe("my-race");
  });

  it("aggiunge suffisso in collisione", () => {
    const taken = new Set(["my-race"]);
    expect(resolveUniqueTrackId("My Race", (id) => taken.has(id))).toBe("my-race-2");
  });

  it("riusa preferredId esistente per update", () => {
    expect(resolveUniqueTrackId("Other", () => true, "hmr-2026")).toBe("hmr-2026");
  });
});

describe("displayNameFromGpxFilename", () => {
  it("legge nome da file", () => {
    expect(displayNameFromGpxFilename("Hellenic_Mountain_Race_2026.gpx")).toBe(
      "Hellenic Mountain Race 2026"
    );
  });
});

describe("mini GPX fixture", () => {
  it("ha almeno due trkpt", () => {
    const pts = parseGpxTrackpoints(MINI_GPX);
    expect(pts.length).toBeGreaterThanOrEqual(2);
  });
});
