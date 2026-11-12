import { describe, expect, it } from "vitest";
import { cleanC2cMarkup, computeRouteFacts, routeFactsBrief, type RouteFactsInput } from "@/lib/route-facts";
import { buildFallbackDescription } from "@/lib/route-description";
import { estimateDurationMin } from "@/lib/route-time";

const base = { length_km: 8, elev_gain_m: 900, elev_loss_m: 900, license: null, source_url: null } as const;

function facts(p: Partial<RouteFactsInput> & Pick<RouteFactsInput, "activity" | "source" | "meta_json">) {
  return computeRouteFacts({ ...base, ...p });
}

describe("computeRouteFacts", () => {
  it("camptocamp ski: Toponeige first, exposure, Labande, orientations, elevation", () => {
    const f = facts({
      activity: "ski",
      source: "camptocamp",
      license: "CC-BY-SA 4.0",
      source_url: "https://www.camptocamp.org/routes/1062176",
      meta_json: JSON.stringify({
        ski_rating: "2.1",
        ski_exposition: "E1",
        labande_global_rating: "PD-",
        labande_ski_rating: "S2",
        elevation_max: 2713,
        elevation_min: 1730,
        orientations: ["W", "NW"],
        summary: null,
      }),
    });
    expect(f.difficulty.map((d) => d.scale)).toEqual(["toponeige", "ski_exposition", "labande_ski", "ifas"]);
    expect(f.difficulty[0]!.value).toBe("2.1");
    expect(f.orientations).toEqual(["O", "NO"]);
    expect(f.elevation).toEqual({ min: 1730, max: 2713, source: "source" });
    expect(f.durationMin).toBe(estimateDurationMin("ski", 8, 900, 900));
    expect(f.attribution).toEqual({ label: "camptocamp.org", license: "CC-BY-SA 4.0", url: "https://www.camptocamp.org/routes/1062176" });
    // nessun testo dalla fonte → descrizione generata
    expect(f.description?.generated).toBe(true);
    expect(f.description?.text).toContain("8,0 km");
  });

  it("camptocamp hike: durations in days never become hours", () => {
    const one = facts({ activity: "hike", source: "camptocamp", meta_json: { c2c_activity: "hiking", hiking_rating: "T4", durations: ["1"] } });
    expect(one.daysLabel).toBeNull();
    expect(one.durationMin).toBe(estimateDurationMin("hike", 8, 900, 900));
    const two = facts({
      activity: "hike",
      source: "camptocamp",
      meta_json: { c2c_activity: "hiking", hiking_rating: "T4", durations: ["2"], summary: "J1 : [[waypoints/1|Refuge]] > col" },
    });
    expect(two.daysLabel).toBe("2 giorni");
    expect(two.difficulty[0]!.value).toBe("T4");
    expect(two.summary?.text).toBe("J1 : Refuge > col");
    expect(facts({ activity: "hike", source: "camptocamp", meta_json: { c2c_activity: "hiking", durations: ["2", "1", "3"] } }).daysLabel).toBe("1–3 giorni");
  });

  it("camptocamp ferrata / snowshoe / mtb / alpinism pick the right scale", () => {
    const fer = facts({ activity: "ferrata", source: "camptocamp", meta_json: { c2c_activity: "via_ferrata", via_ferrata_rating: "K3", global_rating: "PD-" } });
    expect(fer.difficulty.map((d) => d.value)).toEqual(["K3", "PD-"]);
    const sn = facts({ activity: "snowshoe", source: "camptocamp", meta_json: { c2c_activity: "snowshoeing", snowshoe_rating: "R2" } });
    expect(sn.difficulty[0]!.scale).toBe("snowshoe_c2c");
    const mtb = facts({ activity: "mtb", source: "camptocamp", meta_json: { c2c_activity: "mountain_biking", mtb_down_rating: "V3", mtb_up_rating: "M2" } });
    expect(mtb.difficulty.map((d) => d.scale)).toEqual(["mtb_c2c_down", "mtb_c2c_up"]);
    const alp = facts({ activity: "alpinism", source: "camptocamp", meta_json: { c2c_activity: "mountain_climbing", global_rating: "ED4" } });
    expect(alp.difficulty[0]!.label).toBe("Estremamente difficile");
  });

  it("camptocamp enriched text keeps the language", () => {
    const f = facts({
      activity: "ski",
      source: "camptocamp",
      meta_json: { summary: "Bella gita", summary_lang: "it", description: "**Montée**\n\nDe Siviez", description_lang: "fr" },
    });
    expect(f.summary).toEqual({ text: "Bella gita", lang: "it" });
    expect(f.description).toEqual({ text: "Montée\n\nDe Siviez", lang: "fr", generated: false });
  });

  it("OSM: waymark, from/to, way facts override relation sac_scale", () => {
    const f = facts({
      activity: "hike",
      source: "osm",
      meta_json: JSON.stringify({
        route: "hiking",
        network_label: "Locale",
        ref: "212",
        operator: "CAI Bergamo",
        from: "Orgnana",
        to: "Bruno",
        symbol: "red:white:red_bar",
        sac_scale: null,
        description: "Orgnana - Bruno",
        way_facts: { sac_max: "T3", sac_prevalent: "T2", surface: "ground", equipped_m: 0 },
        derived: { shape: "traversata", ele_min_dem: 300, ele_max_dem: 1200 },
      }),
    });
    expect(f.waymark).toEqual({ ref: "212", operator: "CAI Bergamo", symbol: "red:white:red_bar", network: "Locale" });
    expect(f.from).toBe("Orgnana");
    expect(f.difficulty[0]!.value).toBe("T3");
    expect(f.elevation).toEqual({ min: 300, max: 1200, source: "dem" });
    expect(f.routeType).toBe("traversata");
    expect(f.osm?.sacPrevalent).toBe("T2");
    // «Orgnana - Bruno» non è una descrizione: viene generata
    expect(f.description?.generated).toBe(true);
    expect(f.description?.text).toMatch(/^Traversata di 8,0 km/);
    expect(f.description?.text).toContain("Segnavia 212 (CAI Bergamo), da Orgnana a Bruno");
  });

  it("OSM without anything still gets time and attribution", () => {
    const f = facts({ activity: "road", source: "osm", license: "ODbL", meta_json: { route: "bicycle", network: "lcn" } });
    expect(f.difficulty).toEqual([]);
    expect(f.waymark).toBeNull();
    expect(f.durationLabel).toBeTruthy();
    expect(f.attribution?.label).toBe("OpenStreetMap");
  });

  it("user upload ski meta", () => {
    const f = facts({
      activity: "ski",
      source: null,
      meta_json: { zone: "Valmalenco", difficulty: "3.2", exposition: "NE", elevation_max_m: 3020, notes: "Neve ottima in alto" },
    });
    expect(f.difficulty[0]).toMatchObject({ scale: "toponeige", value: "3.2" });
    expect(f.orientations).toEqual(["NE"]);
    expect(f.elevation.max).toBe(3020);
    expect(f.zone).toBe("Valmalenco");
    expect(f.description).toEqual({ text: "Neve ottima in alto", lang: "it", generated: false });
    expect(f.attribution).toBeNull();
  });

  it("tolerates null / broken meta_json", () => {
    for (const meta of [null, "{not json", "[1,2]"]) {
      const f = facts({ activity: "hike", source: null, meta_json: meta });
      expect(f.difficulty).toEqual([]);
      expect(f.durationMin).toBeGreaterThan(0);
    }
    expect(computeRouteFacts({ ...base, length_km: 0, activity: "hike", source: null, meta_json: null }).durationMin).toBeNull();
  });

  it("brief", () => {
    const f = facts({ activity: "hike", source: "camptocamp", meta_json: { c2c_activity: "hiking", hiking_rating: "T2" } });
    expect(routeFactsBrief(f)).toEqual({ difficulty_label: "T2", duration_min: f.durationMin });
  });
});

describe("cleanC2cMarkup", () => {
  it("strips links, headings and bold", () => {
    expect(cleanC2cMarkup("## Accès\n**Montée** par [[routes/12|la voie]] et [site](https://x.y)")).toBe("Accès\nMontée par la voie et site");
  });
});

describe("buildFallbackDescription", () => {
  it("builds an Italian sentence from facts and marks it generated", () => {
    const d = buildFallbackDescription({
      lengthKm: 12.34,
      gainM: 850,
      routeType: "anello",
      elevationMax: 2340,
      difficulty: [],
      durationLabel: "4 h 10",
      waymark: null,
      from: null,
      to: null,
      orientations: [],
      surface: "gravel",
      equippedM: 120,
    });
    expect(d?.generated).toBe(true);
    expect(d?.lang).toBe("it");
    expect(d?.text).toContain("Anello di 12,3 km con 850 m di dislivello positivo, quota massima 2340 m.");
    expect(d?.text).toContain("Fondo prevalente: sterrato.");
    expect(d?.text).toContain("tratti attrezzati (circa 120 m)");
    expect(d?.text).toContain("≈ 4 h 10");
  });

  it("returns null when only the length is known", () => {
    const empty = { gainM: 0, routeType: null, elevationMax: null, difficulty: [], durationLabel: "1 h", waymark: null, from: null, to: null, orientations: [] };
    expect(buildFallbackDescription({ lengthKm: 3, ...empty })).toBeNull();
    expect(buildFallbackDescription({ lengthKm: 0, ...empty })).toBeNull();
  });
});

describe("route type", () => {
  it("camptocamp uses route_types, ignores geometric shape", () => {
    const f = computeRouteFacts({
      ...base,
      activity: "ski",
      source: "camptocamp",
      meta_json: { route_types: ["return_same_way"], derived: { shape: "traversata" } },
    });
    expect(f.routeType).toBe("andata_ritorno");
    expect(computeRouteFacts({ ...base, activity: "hike", source: "camptocamp", meta_json: { derived: { shape: "traversata" } } }).routeType).toBeNull();
    expect(computeRouteFacts({ ...base, activity: "hike", source: "camptocamp", meta_json: { route_types: ["loop_hut"] } }).routeType).toBe("anello");
  });
});
