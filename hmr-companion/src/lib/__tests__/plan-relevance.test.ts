import { describe, expect, it } from "vitest";
import { isRelevantForPlan, planFeatureCollection } from "@/lib/outdoor/plan-relevance";

// Percorso rettilineo verso est di ~3,9 km a lat 45.
const route: [number, number][] = [[9, 45], [9.05, 45]];
const start = { lng: 9, lat: 45 };

describe("punti outdoor nel pianificatore", () => {
  it("cancello solo se sul tracciato", () => {
    expect(isRelevantForPlan("gate", { lng: 9.02, lat: 45.0001 }, { route, start })).toBe(true); // ~11 m
    expect(isRelevantForPlan("gate", { lng: 9.02, lat: 45.001 }, { route, start })).toBe(false); // ~111 m
    expect(isRelevantForPlan("gate", { lng: 9.02, lat: 45 }, { route: null, start: null })).toBe(false);
  });

  it("parcheggio e stazione solo vicino alla partenza", () => {
    expect(isRelevantForPlan("parking", { lng: 9.005, lat: 45 }, { route, start })).toBe(true); // ~400 m
    expect(isRelevantForPlan("train_station", { lng: 9.04, lat: 45 }, { route, start })).toBe(false); // ~3 km
    expect(isRelevantForPlan("parking", { lng: 9.04, lat: 45 }, { route: null, start: null })).toBe(true);
  });

  it("gli altri punti restano e i gruppi selezionati vengono marcati", () => {
    const pt = (kind: string, grp: string, lng: number, lat: number): GeoJSON.Feature => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { kind, grp },
    });
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        pt("drinking_water", "water", 9.03, 45.01),
        pt("gate", "obstacle", 9.03, 45.01),
        pt("peak", "terrain", 9.03, 45.02),
      ],
    };
    const out = planFeatureCollection(fc, { route, start }, ["water"])!;
    expect(out.features.map((f) => [f.properties!.kind, f.properties!.hl])).toEqual([
      ["drinking_water", true],
      ["peak", false],
    ]);
  });
});
