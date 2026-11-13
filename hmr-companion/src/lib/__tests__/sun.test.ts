import { describe, expect, it } from "vitest";
import { sunTimes } from "@/lib/sun";

function minutesUtc(iso: string | null): number {
  const d = new Date(iso as string);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

describe("sunTimes", () => {
  it("Alpi centrali a metà novembre: alba ~07:17 e tramonto ~16:53 ora locale (UTC+1)", () => {
    const s = sunTimes(46.42, 9.35, "2026-11-12");
    expect(s.sunrise?.slice(0, 10)).toBe("2026-11-12");
    expect(Math.abs(minutesUtc(s.sunrise) - (6 * 60 + 17))).toBeLessThanOrEqual(6);
    expect(Math.abs(minutesUtc(s.sunset) - (15 * 60 + 53))).toBeLessThanOrEqual(6);
    expect(s.daylight_hours).toBeGreaterThan(9.3);
    expect(s.daylight_hours).toBeLessThan(9.9);
  });

  it("solstizio d'estate: giornata lunga, alba prima delle 4 UTC", () => {
    const s = sunTimes(46.42, 9.35, "2026-06-21");
    expect(s.daylight_hours).toBeGreaterThan(15.5);
    expect(minutesUtc(s.sunrise)).toBeLessThan(4 * 60);
  });

  it("oltre il circolo polare: notte polare e sole di mezzanotte", () => {
    expect(sunTimes(78, 15, "2026-12-21")).toEqual({ sunrise: null, sunset: null, daylight_hours: 0 });
    expect(sunTimes(78, 15, "2026-06-21")).toEqual({ sunrise: null, sunset: null, daylight_hours: 24 });
  });

  it("data non valida: nessun errore", () => {
    expect(sunTimes(46, 9, "boh").sunrise).toBeNull();
  });
});
