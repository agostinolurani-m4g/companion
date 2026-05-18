import { describe, expect, it } from "vitest";
import type { CheckpointRow, NotableSectionRow, PoiRow, ResupplyRow } from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import {
  buildFullRoadbook,
  buildRoadbookAhead,
  chunkIndexAtKm,
  computeSteepUnpavedInChunk,
  ROADBOOK_SCHEMA_VERSION,
  surfaceKmInRange,
} from "../roadbook-chunk";

const emptyInputs = {
  pois: [] as PoiRow[],
  checkpoints: [] as CheckpointRow[],
  resupply: [] as ResupplyRow[],
  notableSections: [] as NotableSectionRow[],
  racePlanItems: [],
};

function coord(lng: number, lat: number, elev: number | null, cum: number): StoredCoord {
  return [lng, lat, elev, cum];
}

describe("surfaceKmInRange", () => {
  it("clips segments", () => {
    const segs = [
      { km_start: 0, km_end: 5, surface: "gravel" as const },
      { km_start: 5, km_end: 15, surface: "asphalt" as const },
    ];
    const k = surfaceKmInRange(segs, 3, 8);
    expect(k.gravel).toBeCloseTo(2, 5);
    expect(k.asphalt).toBeCloseTo(3, 5);
  });
});

describe("computeSteepUnpavedInChunk", () => {
  it("detects steep gravel segment", () => {
    const coords: StoredCoord[] = [
      coord(0, 0, 1000, 0),
      coord(0.001, 0, 1008, 0.05),
    ];
    const spans = [{ km_start: 0, km_end: 1, surface: "gravel" as const }];
    const r = computeSteepUnpavedInChunk(coords, spans, 0, 1);
    expect(r.steep_unpaved).toBe(true);
    expect(r.steep_unpaved_max_grade_pct).not.toBeNull();
  });

  it("ignores asphalt at midpoint", () => {
    const coords: StoredCoord[] = [
      coord(0, 0, 1000, 0),
      coord(0.001, 0, 1200, 0.2),
    ];
    const spans = [{ km_start: 0, km_end: 1, surface: "asphalt" as const }];
    const r = computeSteepUnpavedInChunk(coords, spans, 0, 1);
    expect(r.steep_unpaved).toBe(false);
  });
});

describe("buildFullRoadbook", () => {
  it("builds chunks with schema version", () => {
    const coords: StoredCoord[] = [
      coord(0, 0, 100, 0),
      coord(0, 0, 110, 5),
      coord(0, 0, 120, 10),
    ];
    const chunks = buildFullRoadbook({
      lengthKm: 10,
      coords,
      surfaceSegments: [{ km_start: 0, km_end: 10, surface: "gravel" }],
      ...emptyInputs,
      chunkKm: 5,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.schema_version).toBe(ROADBOOK_SCHEMA_VERSION);
    expect(chunks[0]!.km_end).toBe(5);
    expect(chunks[1]!.km_start).toBe(5);
  });

  it("sets hike hint from HAB label", () => {
    const coords: StoredCoord[] = [coord(0, 0, 100, 0), coord(0, 0, 100, 12)];
    const sections: NotableSectionRow[] = [
      {
        id: "1",
        track_id: "t",
        label: "HAB: test",
        km_start: 0,
        km_end: 2,
        severity: "info",
        description: "",
      },
    ];
    const chunks = buildFullRoadbook({
      lengthKm: 12,
      coords,
      surfaceSegments: [],
      ...emptyInputs,
      notableSections: sections,
      chunkKm: 10,
    });
    expect(chunks[0]!.hike_a_bike_hint).toBe(true);
  });
});

describe("chunkIndexAtKm", () => {
  it("returns correct index", () => {
    expect(chunkIndexAtKm(0, 100, 10)).toBe(0);
    expect(chunkIndexAtKm(10, 100, 10)).toBe(1);
    expect(chunkIndexAtKm(99, 100, 10)).toBe(9);
  });
});

describe("buildRoadbookAhead", () => {
  it("starts at chunk containing atKm", () => {
    const coords: StoredCoord[] = [coord(0, 0, 50, 0), coord(0, 0, 60, 25)];
    const ahead = buildRoadbookAhead(
      {
        lengthKm: 25,
        coords,
        surfaceSegments: [],
        ...emptyInputs,
        chunkKm: 10,
      },
      15,
      2,
      10
    );
    expect(ahead[0]!.km_start).toBe(10);
    expect(ahead[0]!.km_end).toBe(20);
  });
});
