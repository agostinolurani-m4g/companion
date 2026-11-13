import { describe, expect, it } from "vitest";
import {
  acclimatizationWarnings,
  addDaysIso,
  addMinutesToTime,
  buildStages,
  suggestOvernightKms,
  type ProfilePoint,
} from "@/lib/multiday";
import { outingDays, parseOutingStops } from "@/lib/outings-types";

/** 30 km, un punto ogni 100 m: sale da 1000 a 3000 m nei primi 20 km, poi scende a 2000 m. */
function profile(): ProfilePoint[] {
  const pts: ProfilePoint[] = [];
  for (let i = 0; i <= 300; i++) {
    const km = i / 10;
    const ele = km <= 20 ? 1000 + (km / 20) * 2000 : 3000 - ((km - 20) / 10) * 1000;
    pts.push([9 + km * 0.01, 46, ele, km]);
  }
  return pts;
}

describe("buildStages", () => {
  it("senza pernotti: una sola tappa con tutto il percorso", () => {
    const [s, ...rest] = buildStages(profile(), [], "hike");
    expect(rest).toHaveLength(0);
    expect(s.length_km).toBeCloseTo(30, 1);
    expect(s.overnight).toBe(false);
    expect(s.max_ele_m).toBe(3000);
    expect(s.gain_m).toBeGreaterThan(1900);
    expect(s.loss_m).toBeGreaterThan(900);
  });

  it("divide ai pernotti e tiene nome e quota della notte", () => {
    const stages = buildStages(profile(), [{ km: 12, name: "Rifugio A", exposed: false }], "hike");
    expect(stages).toHaveLength(2);
    expect(stages[0]).toMatchObject({ day: 1, overnight: true, overnight_name: "Rifugio A" });
    expect(stages[0].to_km).toBeCloseTo(12, 1);
    expect(stages[0].end.ele).toBeCloseTo(2200, -1);
    expect(stages[1]).toMatchObject({ day: 2, overnight: false, overnight_name: null });
    expect(stages[0].length_km + stages[1].length_km).toBeCloseTo(30, 1);
    expect(stages[1].max_ele_m).toBe(3000);
  });

  it("ignora pernotti fuori traccia, agli estremi o doppi", () => {
    const stages = buildStages(profile(), [{ km: 0.05 }, { km: 12 }, { km: 12.1 }, { km: 29.95 }, { km: 80 }], "hike");
    expect(stages).toHaveLength(2);
  });

  it("profilo troppo corto: nessuna tappa", () => {
    expect(buildStages([[9, 46, 1000, 0]], [], "hike")).toEqual([]);
  });
});

describe("suggestOvernightKms", () => {
  it("divide in giorni di impegno simile", () => {
    const p = profile();
    const cuts = suggestOvernightKms(p, 3, "hike");
    expect(cuts).toHaveLength(2);
    const stages = buildStages(p, cuts.map((km) => ({ km })), "hike");
    expect(stages).toHaveLength(3);
    const mins = stages.map((s) => s.duration_min);
    expect(Math.max(...mins) / Math.min(...mins)).toBeLessThan(1.4);
    // La salita pesa: il primo taglio arriva prima di un terzo dei km.
    expect(cuts[0]).toBeLessThan(10);
  });

  it("un giorno solo: nessun taglio", () => {
    expect(suggestOvernightKms(profile(), 1, "hike")).toEqual([]);
  });
});

describe("acclimatizationWarnings", () => {
  it("avvisa se la quota di pernotto sale troppo sopra i 2500 m", () => {
    const stages = buildStages(profile(), [{ km: 18 }], "hike"); // notte a 2800 m partendo da 1000 m
    const w = acclimatizationWarnings(stages);
    expect(w).toHaveLength(1);
    expect(w[0].day).toBe(1);
  });

  it("nessun avviso sotto quota o con progressione graduale", () => {
    expect(acclimatizationWarnings(buildStages(profile(), [{ km: 10 }], "hike"))).toEqual([]);
  });
});

describe("date e orari", () => {
  it("addDaysIso attraversa mesi e anni", () => {
    expect(addDaysIso("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysIso("2026-11-14", 0)).toBe("2026-11-14");
  });

  it("addMinutesToTime riporta al giorno dopo", () => {
    expect(addMinutesToTime("06:30", 320)).toEqual({ time: "11:50", dayOffset: 0 });
    expect(addMinutesToTime("20:00", 300)).toEqual({ time: "01:00", dayOffset: 1 });
    expect(addMinutesToTime("boh", 10)).toBeNull();
  });
});

describe("pernotti nelle soste della gita", () => {
  it("solo le soste intermedie possono essere pernotti", () => {
    const stops = parseOutingStops([
      { role: "start", lng: 9, lat: 46, overnight: true },
      { role: "stop", kind: "hut", lng: 9.1, lat: 46, along_km: 12, overnight: true },
      { role: "stop", kind: "water", lng: 9.05, lat: 46, along_km: 5 },
      { role: "end", lng: 9.3, lat: 46 },
    ]);
    expect(stops.map((s) => s.overnight)).toEqual([false, false, true, false]);
    expect(outingDays(stops)).toBe(2);
    expect(outingDays([])).toBe(1);
  });
});
