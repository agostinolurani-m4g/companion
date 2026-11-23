import { describe, expect, it } from "vitest";
import {
  aboveTerrainAt,
  analyzeTrack,
  RUNOUT_ANGLE,
  shapeAt,
  SMALL_SLOPE_M2,
  sizeReduction,
  steepAreaAt,
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

describe("contesto del pendio (stile Skitourenguru)", () => {
  const K = M_LAT * Math.cos((46 * Math.PI) / 180);
  /** Fondovalle piano a sud di lat 46.0, poi un versante di 38° che sale verso nord. */
  const valley: Sampler = (_lng, lat) => {
    const dy = (lat - 46.0) * M_LAT;
    return 1500 + (dy > 0 ? dy * Math.tan((38 * Math.PI) / 180) : 0);
  };

  it("traccia piana ai piedi di un pendio ripido: minacciata da sopra", () => {
    // 40 m a sud del piede del pendio, in piano.
    const lat = 46.0 - 40 / M_LAT;
    const above = aboveTerrainAt(valley, 9, lat);
    expect(above).not.toBeNull();
    expect(above!.slope).toBeGreaterThan(35);
    expect(above!.angle).toBeGreaterThanOrEqual(RUNOUT_ANGLE);
  });

  it("lontano dal pendio (angolo di scorrimento sotto 22°) non è minacciata", () => {
    const lat = 46.0 - 1500 / M_LAT;
    expect(aboveTerrainAt(valley, 9, lat)).toBeNull();
  });

  it("il rischio della traccia piana sale per il pendio a monte", () => {
    const lat = 46.0 - 40 / M_LAT;
    const pts = analyzeTrack(valley, [
      [9.0, lat],
      [9.004, lat],
    ]);
    const b: BulletinInput = {
      maxDanger: 3,
      ratings: [{ level: 3, lower: null, upper: null, aspects: [] }],
      problems: [],
    };
    expect(pts.every((p) => (p.slope ?? 0) < 30)).toBe(true);
    expect(overallRisk(riskSections(b, pts))).toBe("high");
    expect(summarizeTerrain(pts).exposed_above_km).toBeGreaterThan(0.2);
    expect(riskSections(b, pts)[0].reasons[0]).toMatch(/a monte/);
  });

  it("canale: quota sotto la media dei dintorni", () => {
    // Valle a V lungo l'asse nord-sud: x = distanza dall'asse.
    const gully: Sampler = (lng) => 2000 + Math.abs((lng - 9) * K) * 0.8;
    expect(shapeAt(gully, 9, 46)).toBe("gully");
    const ridge: Sampler = (lng) => 2000 - Math.abs((lng - 9) * K) * 0.8;
    expect(shapeAt(ridge, 9, 46)).toBe("ridge");
    expect(shapeAt(northFacing(35), 9, 46)).toBe("planar");
  });

  it("area del pendio ripido e riduzione per pendio piccolo", () => {
    // Gradino ripido largo ~50 m in un pendio dolce.
    const small: Sampler = (lng, lat) => {
      const dx = (lng - 9) * K;
      const dy = (lat - 46) * M_LAT;
      const g = Math.abs(dx) < 30 && Math.abs(dy) < 30 ? 0.8 : 0.1;
      return 1000 + dy * g;
    };
    const slopeAt = (lng: number, lat: number) => slopeAspectAt(small, lng, lat)?.slope ?? null;
    const area = steepAreaAt(slopeAt, 9, 46);
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThan(SMALL_SLOPE_M2);
    const big = steepAreaAt((lng, lat) => slopeAspectAt(northFacing(37), lng, lat)?.slope ?? null, 9, 46);
    expect(big).toBeGreaterThan(200_000);
    expect(sizeReduction(area)).toBe(1.5);
    expect(sizeReduction(big)).toBe(1);
  });
});
