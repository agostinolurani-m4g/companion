import { describe, expect, it } from "vitest";
import { sunPath, sunPosition, terrainSunTimes } from "@/lib/sun";

describe("posizione del sole", () => {
  it("mezzogiorno solare al solstizio d'estate a Milano: a sud, alto ~67°", () => {
    // 21 giugno 2026, mezzogiorno solare a 9.19°E ≈ 11:21 UTC
    const p = sunPosition(Date.UTC(2026, 5, 21, 11, 21), 45.46, 9.19);
    expect(p.azimuth).toBeGreaterThan(170);
    expect(p.azimuth).toBeLessThan(190);
    expect(p.elevation).toBeGreaterThan(66);
    expect(p.elevation).toBeLessThan(69);
  });

  it("al mattino il sole è a est e sale", () => {
    const a = sunPosition(Date.UTC(2026, 2, 20, 6, 30), 46, 9);
    const b = sunPosition(Date.UTC(2026, 2, 20, 7, 30), 46, 9);
    expect(a.azimuth).toBeGreaterThan(80);
    expect(a.azimuth).toBeLessThan(110);
    expect(b.elevation).toBeGreaterThan(a.elevation);
  });

  it("le montagne ritardano l'alba e anticipano il tramonto", () => {
    const path = sunPath(new Date(2026, 11, 21), 46.3, 9.4, 5);
    const flat = terrainSunTimes(path, () => 0);
    const valley = terrainSunTimes(path, () => 12);
    expect(flat.sunrise).not.toBeNull();
    expect(valley.sunrise!).toBeGreaterThan(flat.sunrise!);
    expect(valley.sunset!).toBeLessThan(flat.sunset!);
    expect(valley.hours).toBeLessThan(flat.hours);
    // Inverno, 46°N: sole alto al massimo ~20°: con orizzonte a 25° non si vede mai.
    expect(terrainSunTimes(path, () => 25).sunrise).toBeNull();
  });
});
