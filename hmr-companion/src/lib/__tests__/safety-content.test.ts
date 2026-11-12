import { describe, expect, it } from "vitest";
import { AVALANCHE_DANGER_SCALE, CALL_SCRIPT, checklistForSport, EMERGENCY_NUMBERS } from "@/lib/content/safety";
import { USER_ROUTE_ACTIVITIES } from "@/lib/sports";

describe("contenuti sicurezza", () => {
  it("scala europea a 5 gradi con nomi italiani", () => {
    expect(AVALANCHE_DANGER_SCALE.map((d) => d.level)).toEqual([1, 2, 3, 4, 5]);
    expect(AVALANCHE_DANGER_SCALE.map((d) => d.name)).toEqual(["Debole", "Moderato", "Marcato", "Forte", "Molto forte"]);
  });

  it("112 presente e guida alla chiamata con la posizione", () => {
    expect(EMERGENCY_NUMBERS[0].number).toBe("112");
    expect(CALL_SCRIPT.some((c) => c.title === "Dove sei")).toBe(true);
  });

  it("ogni sport ha la checklist di base più quella specifica", () => {
    for (const a of USER_ROUTE_ACTIVITIES) {
      const groups = checklistForSport(a);
      expect(groups[0].id).toBe("base");
      expect(groups.length).toBeGreaterThan(1);
    }
    expect(checklistForSport("ski").some((g) => g.items.some((i) => i.includes("ARTVA")))).toBe(true);
    expect(checklistForSport("road").some((g) => g.items.some((i) => i.includes("ARTVA")))).toBe(false);
  });
});
