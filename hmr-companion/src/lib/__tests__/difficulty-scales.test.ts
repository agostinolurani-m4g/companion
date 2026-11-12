import { describe, expect, it } from "vitest";
import { DIFFICULTY_SCALES, lookupGrade, scaleForSport } from "@/lib/content/difficulty-scales";
import { USER_ROUTE_ACTIVITIES } from "@/lib/sports";

describe("difficulty scales", () => {
  it("every grade has an Italian label and explanation", () => {
    for (const scale of Object.values(DIFFICULTY_SCALES)) {
      expect(scale.grades.length).toBeGreaterThan(0);
      for (const g of scale.grades) {
        expect(g.label.length).toBeGreaterThan(2);
        expect(g.explanation.length).toBeGreaterThan(15);
      }
    }
  });

  it("covers the expected grade ranges", () => {
    expect(DIFFICULTY_SCALES.sac.grades.map((g) => g.value)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
    expect(DIFFICULTY_SCALES.husler.grades).toHaveLength(6);
    expect(DIFFICULTY_SCALES.wt.grades).toHaveLength(6);
    expect(DIFFICULTY_SCALES.ski_exposition.grades).toHaveLength(4);
    expect(DIFFICULTY_SCALES.mtb_scale.grades.map((g) => g.value)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(DIFFICULTY_SCALES.ifas.grades.map((g) => g.value)).toEqual(["F", "PD", "AD", "D", "TD", "ED"]);
  });

  it("looks up tolerant variants", () => {
    expect(lookupGrade("sac", "t3")?.value).toBe("T3");
    expect(lookupGrade("sac", " T 4 ")?.value).toBe("T4");
    expect(lookupGrade("sac", "demanding_mountain_hiking")?.value).toBe("T3");
    expect(lookupGrade("sac", "difficult_alpine_hiking")?.value).toBe("T6");
    expect(lookupGrade("toponeige", "2.3")?.label).toBe("Poco difficile");
    expect(lookupGrade("toponeige", "2.3")?.value).toBe("2.3");
    expect(lookupGrade("toponeige", 4)?.label).toBe("Difficile");
    expect(lookupGrade("ifas", "PD+")?.label).toBe("Poco difficile");
    expect(lookupGrade("ifas", "PD+")?.value).toBe("PD+");
    expect(lookupGrade("ifas", "ED4")?.label).toBe("Estremamente difficile");
    expect(lookupGrade("ifas", "d-")?.label).toBe("Difficile");
    expect(lookupGrade("husler", "k3")?.value).toBe("K3");
    expect(lookupGrade("snowshoe_c2c", "R2")?.label).toBe("Poco difficile");
    expect(lookupGrade("mtb_c2c_down", "V3")).not.toBeNull();
    expect(lookupGrade("mtb_scale", "2+")?.value).toBe("2+");
  });

  it("returns null for unknown values", () => {
    expect(lookupGrade("sac", "T7")).toBeNull();
    expect(lookupGrade("toponeige", "6.1")).toBeNull();
    expect(lookupGrade("ifas", "XX")).toBeNull();
    expect(lookupGrade("husler", "")).toBeNull();
    expect(lookupGrade("sac", null)).toBeNull();
    expect(lookupGrade("sac", { a: 1 })).toBeNull();
  });

  it("maps every sport to a scale or null", () => {
    for (const a of USER_ROUTE_ACTIVITIES) {
      const s = scaleForSport(a);
      if (s) expect(DIFFICULTY_SCALES[s]).toBeDefined();
    }
    expect(scaleForSport("hike")).toBe("sac");
    expect(scaleForSport("road")).toBeNull();
  });
});
