import { describe, expect, it } from "vitest";
import {
  analyzeTrack,
  dangerAt,
  overallRisk,
  parseBandElevation,
  riskSections,
  slopeAspectAt,
  summarizeTerrain,
  type BulletinInput,
  type Sampler,
} from "@/lib/ski-terrain";

const M_LAT = 111_320;

/** Piano inclinato: sale verso sud con pendenza `deg` (quindi il versante è esposto a NORD). */
function northFacing(deg: number): Sampler {
  const g = Math.tan((deg * Math.PI) / 180);
  return (_lng, lat) => 1500 + (46 - lat) * M_LAT * g;
}

describe("slopeAspectAt", () => {
  it("pendenza ed esposizione di un piano", () => {
    const r = slopeAspectAt(northFacing(35), 9, 46)!;
    expect(r.slope).toBeCloseTo(35, 0);
    expect(r.aspect).toBe("N");
  });

  it("versante est", () => {
    const g = Math.tan((20 * Math.PI) / 180);
    const east: Sampler = (lng) => 2000 - (lng - 9) * M_LAT * Math.cos((46 * Math.PI) / 180) * g;
    const r = slopeAspectAt(east, 9, 46)!;
    expect(r.slope).toBeCloseTo(20, 0);
    expect(r.aspect).toBe("E");
  });
});

describe("analisi traccia e rischio", () => {
  // Traverso est-ovest di ~1 km su un versante nord di 37°.
  const coords: [number, number][] = [
    [9.0, 46.0],
    [9.013, 46.0],
  ];
  const pts = analyzeTrack(northFacing(37), coords);

  it("la traccia è piana ma il versante è ripido", () => {
    const sum = summarizeTerrain(pts);
    expect(sum.length_km).toBeGreaterThan(0.95);
    expect(sum.max_slope).toBe(37);
    expect(sum.slope_km[3]).toBeGreaterThan(0.9); // 35–40°
    expect(sum.aspect_km_steep.N).toBeGreaterThan(0.9);
  });

  const bulletin = (level: number, problemAspects: ("N" | "S")[]): BulletinInput => ({
    maxDanger: level,
    ratings: [{ level, lower: null, upper: null, aspects: [] }],
    problems: [{ aspects: problemAspects, lower: 1200, upper: null }],
  });

  it("grado 3 su esposizione critica: rischio alto", () => {
    const s = riskSections(bulletin(3, ["N"]), pts);
    expect(overallRisk(s)).toBe("high");
  });

  it("grado 2 con esposizione fuori dal problema: rischio basso", () => {
    // 2^2 / (2 pendenza 35–40 × 2 esposizione) = 1 → basso
    expect(overallRisk(riskSections(bulletin(2, ["S"]), pts))).toBe("low");
  });

  it("grado per quota", () => {
    const b: BulletinInput = {
      maxDanger: 3,
      ratings: [
        { level: 2, lower: null, upper: 2200, aspects: [] },
        { level: 3, lower: 2200, upper: null, aspects: [] },
      ],
      problems: [],
    };
    expect(dangerAt(b, 1800, "N")).toBe(2);
    expect(dangerAt(b, 2600, "N")).toBe(3);
    expect(parseBandElevation("treeline")).toBe(2000);
    expect(parseBandElevation("2400")).toBe(2400);
  });
});
