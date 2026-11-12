import { describe, expect, it } from "vitest";
import {
  formatOutingDate,
  normalizeOutingDate,
  normalizeStartTime,
  outingNeedsReport,
  parseOutingConditions,
  parseOutingStops,
  stopKindFromOutdoorKind,
  stopKindFromPoiCategory,
  summarizeConditions,
} from "../outings-types";
import { outingConditionFields } from "../sports";

describe("outings-types", () => {
  it("formats outing dates in Italian", () => {
    expect(formatOutingDate("2026-01-15")).toMatch(/15/);
    expect(formatOutingDate(null)).toBe("Data non indicata");
  });

  it("parses and cleans conditions", () => {
    const c = parseOutingConditions({
      snow: { quality: "powder", from_ele_m: "1800", note: "  ok  " },
      weather: { sky: "tornado", wind: "calm" },
      access: { ok: true },
      trail: {},
      rating: 7,
    });
    expect(c).toEqual({
      snow: { quality: "powder", from_ele_m: 1800, note: "ok" },
      weather: { wind: "calm" },
      access: { ok: true },
    });
    expect(parseOutingConditions("{bad")).toBeNull();
    expect(parseOutingConditions({})).toBeNull();
    expect(parseOutingConditions(JSON.stringify({ rating: 4 }))).toEqual({ rating: 4 });
    expect(summarizeConditions(c)).toContain("accesso ok");
  });

  it("orders stops: start, stops by km, end", () => {
    const stops = parseOutingStops([
      { role: "end", lng: 9.2, lat: 46.2, name: "Arrivo" },
      { role: "stop", lng: 9.1, lat: 46.1, along_km: 5, kind: "hut" },
      { role: "stop", lng: 9.05, lat: 46.05, along_km: 2, kind: "nope" },
      { role: "start", lng: 9, lat: 46 },
      { role: "stop", lng: 999, lat: 46 },
    ]);
    expect(stops.map((s) => s.role)).toEqual(["start", "stop", "stop", "end"]);
    expect(stops[1].along_km).toBe(2);
    expect(stops[1].kind).toBe("other");
    expect(stops[0].kind).toBe("parking");
  });

  it("maps POI/feature kinds to stop kinds", () => {
    expect(stopKindFromOutdoorKind("wilderness_hut")).toBe("bivouac");
    expect(stopKindFromOutdoorKind("shop_supermarket")).toBe("supermarket");
    expect(stopKindFromPoiCategory("shop")).toBe("supermarket");
    expect(stopKindFromPoiCategory("hut", "wilderness_hut")).toBe("bivouac");
  });

  it("validates date/time and report reminder", () => {
    expect(normalizeOutingDate("2026-02-30x")).toBeNull();
    expect(normalizeOutingDate("2026-02-03")).toBe("2026-02-03");
    expect(normalizeStartTime("7:30")).toBeNull();
    expect(normalizeStartTime("07:30")).toBe("07:30");
    const today = new Date("2026-03-10T10:00:00Z");
    expect(outingNeedsReport({ status: "planned", outing_date: "2026-03-09" }, today)).toBe(true);
    expect(outingNeedsReport({ status: "planned", outing_date: "2026-03-11" }, today)).toBe(false);
    expect(outingNeedsReport({ status: "done", outing_date: "2026-03-09" }, today)).toBe(false);
  });

  it("condition fields depend on sport", () => {
    expect(outingConditionFields("ski")).toContain("snow");
    expect(outingConditionFields("road")).not.toContain("snow");
  });
});
