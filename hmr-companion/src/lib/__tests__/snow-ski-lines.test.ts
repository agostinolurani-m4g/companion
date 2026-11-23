import { describe, expect, it } from "vitest";
import { skiLineColor, skiLineFeatures, SKI_LINE_UNRATED, toponeigeClass } from "@/lib/ski-lines";
import { gridStepForZoom, snowCellsForBbox, snowCellsToGeoJson, snowColor, snowDepthNowCm } from "@/lib/snow-depth";

describe("griglia altezza neve", () => {
  const bbox = { south: 46.2, west: 9.3, north: 46.4, east: 9.6 };

  it("celle allineate e stabili fra richieste", () => {
    const a = snowCellsForBbox(bbox, 11);
    const b = snowCellsForBbox({ ...bbox, west: 9.31 }, 11);
    expect(a.length).toBeGreaterThan(100);
    expect(a.length).toBeLessThanOrEqual(400);
    expect(a[0].size).toBe(gridStepForZoom(11));
    // Stessa griglia: le celle in comune hanno la stessa chiave (cache).
    const keysA = new Set(a.map((c) => c.key));
    expect(b.filter((c) => keysA.has(c.key)).length).toBeGreaterThan(b.length * 0.8);
  });

  it("area enorme: il passo cresce per restare nel limite", () => {
    const cells = snowCellsForBbox({ south: 44, west: 5, north: 48, east: 15 }, 11, 300);
    expect(cells.length).toBeLessThanOrEqual(300);
    expect(cells[0].size).toBeGreaterThan(0.02);
  });

  it("valore all'ora corrente e colori", () => {
    const now = Date.parse("2026-12-10T10:20:00Z");
    const cm = snowDepthNowCm({ time: ["2026-12-10T09:00", "2026-12-10T10:00", "2026-12-10T11:00"], snow_depth: [0.4, 0.55, 0.6] }, now);
    expect(cm).toBe(55);
    expect(snowColor(0)).toBeNull();
    expect(snowColor(55)).not.toBeNull();
    expect(snowColor(250)).not.toBe(snowColor(5));
    const fc = snowCellsToGeoJson([
      { key: "a", lat: 46, lng: 9, size: 0.02, cm: 55 },
      { key: "b", lat: 46, lng: 9.02, size: 0.02, cm: 0 },
    ]);
    expect(fc.features).toHaveLength(1);
  });
});

describe("linee di sci", () => {
  it("classe Toponeige e colore", () => {
    expect(toponeigeClass("3.2")).toBe(3);
    expect(toponeigeClass("5.4")).toBe(5);
    expect(toponeigeClass("x")).toBeNull();
    expect(skiLineColor(null)).toBe(SKI_LINE_UNRATED);
  });

  it("prende solo le discese se ci sono", () => {
    const geojson = JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { mode: "ascent" }, geometry: { type: "LineString", coordinates: [[9, 46], [9.01, 46.01]] } },
        { type: "Feature", properties: { mode: "descent" }, geometry: { type: "LineString", coordinates: [[9.01, 46.01], [9.02, 46]] } },
      ],
    });
    const f = skiLineFeatures({ id: "r1", name: "Pizzo", geojson, meta_json: JSON.stringify({ ski_rating: "2.3" }) });
    expect(f).toHaveLength(1);
    expect(f[0].properties).toMatchObject({ routeId: "r1", cls: 2 });
    const single = skiLineFeatures({
      id: "r2",
      name: "Solo traccia",
      geojson: JSON.stringify({ type: "LineString", coordinates: [[9, 46], [9.01, 46.01]] }),
      meta_json: null,
    });
    expect(single).toHaveLength(1);
  });
});
