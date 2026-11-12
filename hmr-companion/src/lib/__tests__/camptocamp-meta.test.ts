import { describe, expect, it } from "vitest";
import { pickLocaleText, type C2cRouteDetail } from "@/lib/camptocamp";
import { buildC2cMeta, C2C_DESCRIPTION_MAX, mergeC2cMeta } from "@/lib/camptocamp-meta";

const skiDetail = {
  document_id: 1062176,
  locales: [{ lang: "fr", title: "Greppon Blanc", description: "**Montée**\n\nDe Siviez…", summary: null }],
  ski_rating: "2.1",
  ski_exposition: "E1",
  labande_ski_rating: "S2",
  labande_global_rating: "PD-",
  elevation_max: 2713,
  elevation_min: 1730,
  height_diff_up: 985,
  height_diff_down: 985,
  orientations: ["W"],
  durations: ["1"],
  calculated_duration: null,
  lift_access: true,
  associations: {
    waypoints: [
      { document_id: 1, waypoint_type: "summit", elevation: 2713, locales: [{ lang: "fr", title: "Greppon Blanc" }] },
      {
        document_id: 2,
        waypoint_type: "access",
        elevation: 1733,
        locales: [{ lang: "fr", title: "Siviez" }],
        geometry: { geom: JSON.stringify({ type: "Point", coordinates: [819_000, 5_800_000] }) },
      },
    ],
  },
  areas: [{ area_type: "range", locales: [{ lang: "fr", title: "Alpes valaisannes" }] }],
} as unknown as C2cRouteDetail;

describe("pickLocaleText", () => {
  const locales = [
    { lang: "fr", title: "x", summary: "fr text" },
    { lang: "en", title: "x", summary: "  " },
    { lang: "de", title: "x", summary: "de text" },
  ];
  it("prefers it → en → fr, skipping blanks", () => {
    expect(pickLocaleText(locales, "summary")).toEqual({ text: "fr text", lang: "fr" });
    expect(pickLocaleText([...locales, { lang: "it", title: "x", summary: "it" }], "summary")?.lang).toBe("it");
  });
  it("falls back to any other language", () => {
    expect(pickLocaleText([{ lang: "de", title: "x", summary: "de" }], "summary")).toEqual({ text: "de", lang: "de" });
    expect(pickLocaleText([], "summary")).toBeNull();
  });
});

describe("buildC2cMeta", () => {
  it("ski: keeps ratings, adds description with language, durations, access, areas", () => {
    const m = buildC2cMeta(skiDetail, "skitouring", 123);
    expect(m.c2c_activity).toBeUndefined();
    expect(m.ski_rating).toBe("2.1");
    expect(m.summary).toBeNull();
    expect(m.description).toBe("**Montée**\n\nDe Siviez…");
    expect(m.description_lang).toBe("fr");
    expect(m.durations).toEqual(["1"]);
    expect(m.calculated_duration).toBeUndefined();
    expect(m.lift_access).toBe(true);
    expect(m.areas).toEqual(["Alpes valaisannes"]);
    const access = m.access as { name: string; lng: number; lat: number; elevation: number };
    expect(access.name).toBe("Siviez");
    expect(access.elevation).toBe(1733);
    expect(access.lng).toBeGreaterThan(7);
    expect(access.lat).toBeGreaterThan(45);
    expect(m.enriched_at).toBe(123);
  });

  it("other activities: c2c_activity and rating keys", () => {
    const m = buildC2cMeta(
      { document_id: 5, locales: [{ lang: "it", title: "Ferrata", summary: "Bella" }], via_ferrata_rating: "K3", global_rating: "PD" } as unknown as C2cRouteDetail,
      "via_ferrata",
    );
    expect(m).toMatchObject({ c2c_activity: "via_ferrata", via_ferrata_rating: "K3", global_rating: "PD", summary: "Bella", summary_lang: "it" });
    expect(m.ski_rating).toBeUndefined();
  });

  it("truncates very long descriptions", () => {
    const long = "Frase lunga. ".repeat(1000);
    const m = buildC2cMeta({ document_id: 6, locales: [{ lang: "it", title: "x", description: long }] } as unknown as C2cRouteDetail, "hiking");
    expect((m.description as string).length).toBeLessThanOrEqual(C2C_DESCRIPTION_MAX + 2);
    expect(m.description as string).toMatch(/…$/);
  });
});

describe("mergeC2cMeta", () => {
  it("preserves derived facts and import activity", () => {
    const out = mergeC2cMeta({ derived: { shape: "anello" }, quality: 0.4, c2c_activity: "hiking", summary: "old" }, { summary: "new" });
    expect(out).toEqual({ summary: "new", derived: { shape: "anello" }, quality: 0.4, c2c_activity: "hiking" });
    expect(mergeC2cMeta(null, { a: 1 })).toEqual({ a: 1 });
  });
});
