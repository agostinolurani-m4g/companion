import { describe, expect, it } from "vitest";
import {
  assessHour,
  dewPointC,
  frostbiteMinutes,
  sleepingBagComfortC,
  summarizeThermal,
  waterLitersPerHour,
  wetBulbC,
  windChillC,
} from "@/lib/thermal";

describe("grandezze termiche", () => {
  it("punto di rugiada: aria satura = temperatura, aria secca molto più basso", () => {
    expect(dewPointC(10, 100)).toBeCloseTo(10, 1);
    // Valore di riferimento: 20 °C al 50 % → 9,3 °C.
    expect(dewPointC(20, 50)).toBeCloseTo(9.3, 0);
  });

  it("bulbo umido (Stull): 20 °C al 50 % ≈ 13,7 °C e mai sopra la temperatura", () => {
    expect(wetBulbC(20, 50)).toBeCloseTo(13.7, 0);
    expect(wetBulbC(30, 99)).toBeLessThanOrEqual(30.2);
  });

  it("wind chill JAG/TI: −10 °C con 30 km/h ≈ −20 °C", () => {
    expect(windChillC(-10, 30)).toBeCloseTo(-19.5, 0);
  });

  it("wind chill non si applica sopra 10 °C o con vento debole", () => {
    expect(windChillC(15, 50)).toBe(15);
    expect(windChillC(-5, 3)).toBe(-5);
    expect(windChillC(-5, null)).toBe(-5);
  });

  it("tempi di congelamento per fasce di wind chill", () => {
    expect(frostbiteMinutes(-20)).toBeNull();
    expect(frostbiteMinutes(-30)).toEqual({ min: 10, max: 30 });
    expect(frostbiteMinutes(-45)).toEqual({ min: 5, max: 10 });
    expect(frostbiteMinutes(-60)).toEqual({ min: 0, max: 2 });
  });
});

describe("assessHour", () => {
  const ids = (h: Parameters<typeof assessHour>[0]) => assessHour(h).hazards.map((x) => x.id);

  it("congelamento con freddo e raffiche forti", () => {
    const a = assessHour({ temperature_c: -22, humidity_pct: 60, wind_kmh: 30, gust_kmh: 60 });
    expect(a.hazards[0]).toMatchObject({ id: "frostbite", level: 2 });
    expect(a.wind_chill_gust_c).toBeLessThan(a.wind_chill_c);
  });

  it("freddo umido: pioggia e vento poco sopra zero", () => {
    expect(ids({ temperature_c: 3, humidity_pct: 95, wind_kmh: 25, gust_kmh: 45, precipitation_mm: 2.5 })).toContain("wet_cold");
    // Stessa temperatura, asciutto: nessun allarme.
    expect(ids({ temperature_c: 3, humidity_pct: 60, wind_kmh: 25, gust_kmh: 45, precipitation_mm: 0 })).not.toContain("wet_cold");
  });

  it("caldo umido e aria satura", () => {
    expect(ids({ temperature_c: 33, humidity_pct: 70, wind_kmh: 5 })).toContain("heat");
    expect(ids({ temperature_c: 2, humidity_pct: 99, wind_kmh: 5 })).toContain("low_visibility");
  });

  it("giornata mite e asciutta: nessun pericolo", () => {
    expect(ids({ temperature_c: 14, humidity_pct: 55, wind_kmh: 10, gust_kmh: 20 })).toEqual([]);
  });

  it("senza umidità non inventa rugiada e bulbo umido", () => {
    const a = assessHour({ temperature_c: 5, humidity_pct: null, wind_kmh: 10 });
    expect(a.dew_point_c).toBeNull();
    expect(a.wet_bulb_c).toBeNull();
  });
});

describe("summarizeThermal", () => {
  it("estremi della finestra e rigelo dopo la pioggia", () => {
    const s = summarizeThermal([
      { time: "2026-11-14T14:00", temperature_c: 3, humidity_pct: 90, wind_kmh: 5, precipitation_mm: 1 },
      { time: "2026-11-14T20:00", temperature_c: 0, humidity_pct: 85, wind_kmh: 5 },
      { time: "2026-11-15T04:00", temperature_c: -4, humidity_pct: 70, wind_kmh: 5 },
    ]);
    expect(s.temp_min_c).toBe(-4);
    expect(s.temp_max_c).toBe(3);
    expect(s.humidity_min_pct).toBe(70);
    expect(s.humidity_max_pct).toBe(90);
    expect(s.hazards.map((h) => h.id)).toContain("refreeze");
  });

  it("gelo continuo senza fusione: nessun rigelo", () => {
    const s = summarizeThermal([
      { time: "a", temperature_c: -3, humidity_pct: 60, wind_kmh: 5 },
      { time: "b", temperature_c: -6, humidity_pct: 60, wind_kmh: 5 },
    ]);
    expect(s.hazards.map((h) => h.id)).not.toContain("refreeze");
  });
});

describe("stime pratiche", () => {
  it("sacco a pelo: margine maggiore all'addiaccio", () => {
    expect(sleepingBagComfortC(-5, false)).toBe(-8);
    expect(sleepingBagComfortC(-5, true)).toBe(-11);
  });

  it("acqua: cresce con caldo e quota", () => {
    const cool = waterLitersPerHour(5, 60, 1500);
    expect(waterLitersPerHour(28, 60, 1500)).toBeGreaterThan(cool);
    expect(waterLitersPerHour(5, 60, 3200)).toBeGreaterThan(cool);
  });
});
