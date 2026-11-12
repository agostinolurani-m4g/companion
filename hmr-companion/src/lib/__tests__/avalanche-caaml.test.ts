import { describe, expect, it } from "vitest";
import {
  bulletinCacheTtlMs,
  bulletinDangerLabel,
  checkRouteAspects,
  dangerForElevationBand,
  elevationBandLabel,
  isBulletinValidAt,
  normalizeAspects,
  parseCaamlBulletins,
  pointInGeometry,
  selectRegionBulletins,
  stripHtml,
} from "@/lib/avalanche-caaml";

/** Estratto (testi accorciati) del file reale 2026-02-15-IT-25.it.json (AINEVA Lombardia). */
const IT25 = {
  bulletins: [
    {
      avalancheActivity: { highlights: "A quote medie e alte pericolo marcato.", comment: "Distacchi facili. <br/> Rumori di «whumpf»." },
      avalancheProblems: [
        {
          problemType: "persistent_weak_layers",
          aspects: ["NW", "W", "E", "N", "NE"],
          avalancheSize: 3,
          elevation: { lowerBound: "2100" },
          validTimePeriod: "all_day",
        },
        {
          problemType: "wind_slab",
          aspects: ["SW", "NW", "W", "E", "SE", "N", "S", "NE"],
          avalancheSize: 2,
          elevation: { lowerBound: "treeline" },
          validTimePeriod: "all_day",
        },
      ],
      bulletinID: "ad20f1a5",
      dangerRatings: [
        { mainValue: "moderate", elevation: { upperBound: "2100" }, validTimePeriod: "all_day" },
        { mainValue: "considerable", elevation: { lowerBound: "2100" }, validTimePeriod: "all_day" },
      ],
      lang: "it",
      publicationTime: "2026-02-14T16:00:00+00:00",
      regions: [
        { regionID: "IT-25-SO-03", name: "RETICHE ORIENTALI" },
        { regionID: "IT-25-SO-04", name: "IT-25-SO-04" },
      ],
      snowpackStructure: { comment: "Brina di superficie." },
      source: { provider: { name: "AINEVA Lombardia", website: "https://bollettini.aineva.it" } },
      tendency: [{ tendencyType: "steady", validTime: { startTime: "2026-02-15T23:00:00+00:00", endTime: "2026-02-16T23:00:00+00:00" } }],
      unscheduled: false,
      validTime: { startTime: "2026-02-14T23:00:00+00:00", endTime: "2026-02-15T23:00:00+00:00" },
    },
    {
      avalancheProblems: [{ problemType: "wind_slab", aspects: ["N"], elevation: { lowerBound: "1000" } }],
      bulletinID: "d679a231",
      dangerRatings: [{ mainValue: "low", validTimePeriod: "all_day" }],
      lang: "it",
      publicationTime: "2026-02-14T16:00:00+00:00",
      regions: [{ regionID: "IT-25-BG-02", name: "PREALPI BERGAMASCHE" }],
      source: { provider: { name: "AINEVA Lombardia" } },
      validTime: { startTime: "2026-02-14T23:00:00+00:00", endTime: "2026-02-15T23:00:00+00:00" },
    },
  ],
};

const NOON_15 = Date.parse("2026-02-15T12:00:00Z");

describe("parseCaamlBulletins", () => {
  const parsed = parseCaamlBulletins(IT25);

  it("crea un elemento per micro-regione con grado massimo, problemi, tendenza e testo", () => {
    expect(parsed.map((b) => b.regionId)).toEqual(["IT-25-SO-03", "IT-25-SO-04", "IT-25-BG-02"]);
    const so3 = parsed[0];
    expect(so3.regionName).toBe("RETICHE ORIENTALI");
    expect(parsed[1].regionName).toBe("IT-25-SO-04");
    expect(so3.maxDanger).toBe(3);
    expect(so3.problems.map((p) => p.label)).toEqual(["Strati deboli persistenti", "Neve ventata"]);
    expect(so3.problems[0].aspects).toEqual(["N", "NE", "E", "W", "NW"]);
    expect(so3.problems[0].elevation).toEqual({ lower: "2100", upper: null });
    expect(so3.tendency?.label).toBe("Pericolo stazionario");
    expect(so3.highlights).toBe("A quote medie e alte pericolo marcato.");
    expect(so3.activityComment).toBe("Distacchi facili. Rumori di «whumpf».");
    expect(so3.provider.name).toBe("AINEVA Lombardia");
    expect(so3.validUntil).toBe("2026-02-15T23:00:00+00:00");
    expect(parsed[2].maxDanger).toBe(1);
  });

  it("bollettino senza neve (MeteoMont) non ha grado ma è riconosciuto", () => {
    const [m] = parseCaamlBulletins({
      bulletins: [
        {
          dangerRatings: [{ mainValue: "no_snow" }, { mainValue: "no_snow" }],
          regions: [{ regionID: "IT-MeteoMont-13-3", name: "CALABRIA / Appennino Calabro" }],
          source: { provider: { name: "METEOMONT Carabinieri" } },
          validTime: { startTime: "2026-11-10T00:00:00+01:00", endTime: "2026-11-11T00:00:00+01:00" },
        },
      ],
    });
    expect(m.maxDanger).toBeNull();
    expect(m.ratingNote).toBe("no_snow");
    expect(bulletinDangerLabel(m)).toBe("Senza neve");
    expect(bulletinDangerLabel(parsed[0])).toBe("3 — Marcato");
  });

  it("tollera input non validi", () => {
    expect(parseCaamlBulletins(null)).toEqual([]);
    expect(parseCaamlBulletins({ bulletins: "x" })).toEqual([]);
  });

  it("grado per fascia di quota delle micro-regioni divise high/low", () => {
    const so3 = parsed[0];
    expect(dangerForElevationBand(so3, "high")).toBe(3);
    expect(dangerForElevationBand(so3, "low")).toBe(2);
    expect(dangerForElevationBand(so3, "all")).toBe(3);
    expect(dangerForElevationBand(parsed[2], "high")).toBe(1);
  });
});

describe("validità e cache del bollettino", () => {
  const parsed = parseCaamlBulletins(IT25);

  it("valido solo dentro validTime", () => {
    expect(isBulletinValidAt(parsed[0], NOON_15)).toBe(true);
    expect(isBulletinValidAt(parsed[0], Date.parse("2026-02-16T00:00:00Z"))).toBe(false);
    expect(isBulletinValidAt({ validFrom: null, validUntil: null }, NOON_15)).toBe(false);
  });

  it("TTL legato a validUntil, al massimo 3 ore, mai 7 giorni", () => {
    const until = "2026-02-15T23:00:00+00:00";
    expect(bulletinCacheTtlMs([until], NOON_15)).toBe(3 * 3600_000);
    const late = Date.parse("2026-02-15T22:00:00Z");
    expect(bulletinCacheTtlMs([until], late)).toBe(3600_000);
    // scadenza imminente: minimo 5 minuti
    expect(bulletinCacheTtlMs([until], Date.parse("2026-02-15T22:59:00Z"))).toBe(5 * 60_000);
    // si usa la prima scadenza
    expect(bulletinCacheTtlMs(["2026-02-15T13:00:00Z", until], NOON_15)).toBe(3600_000);
    // nessun bollettino in vigore: 1 ora
    expect(bulletinCacheTtlMs([], NOON_15)).toBe(3600_000);
    expect(bulletinCacheTtlMs(["2026-02-14T00:00:00Z"], NOON_15)).toBe(3600_000);
  });

  it("sceglie per regione il bollettino in vigore e quello successivo", () => {
    const tomorrow = parseCaamlBulletins({
      bulletins: [
        {
          ...IT25.bulletins[1],
          bulletinID: "next",
          dangerRatings: [{ mainValue: "moderate" }],
          publicationTime: "2026-02-15T16:00:00+00:00",
          validTime: { startTime: "2026-02-15T23:00:00+00:00", endTime: "2026-02-16T23:00:00+00:00" },
        },
      ],
    });
    const { current, next } = selectRegionBulletins([...parsed, ...tomorrow], NOON_15);
    expect(current.get("IT-25-BG-02")?.maxDanger).toBe(1);
    expect(next.get("IT-25-BG-02")?.maxDanger).toBe(2);
    const later = selectRegionBulletins([...parsed, ...tomorrow], Date.parse("2026-02-16T08:00:00Z"));
    expect(later.current.get("IT-25-BG-02")?.bulletinId).toBe("next");
    expect(later.current.has("IT-25-SO-03")).toBe(false);
  });
});

describe("checkRouteAspects", () => {
  const so3 = parseCaamlBulletins(IT25)[0];

  it("segnala esposizioni critiche in comune", () => {
    const r = checkRouteAspects(["N", "NW"], so3);
    expect(r.status).toBe("match");
    expect(r.matchedAspects).toEqual(["N", "NW"]);
    expect(r.text).toContain("Il percorso è esposto a N, NW");
    expect(r.text).toContain("Strati deboli persistenti (sopra 2100 m)");
    expect(r.text).toContain("3 — Marcato");
  });

  it("esclude i problemi fuori dalla fascia di quota del percorso", () => {
    const r = checkRouteAspects(["N"], so3, { minEle: 1200, maxEle: 1800 });
    expect(r.status).toBe("match");
    // treeline → considerato sovrapposto per prudenza, 2100 m no
    expect(r.matchedProblems).toEqual(["Neve ventata (sopra il limite del bosco)"]);
  });

  it("nessuna corrispondenza", () => {
    const bg2 = parseCaamlBulletins(IT25)[2];
    const r = checkRouteAspects(["S", "SE"], bg2);
    expect(r.status).toBe("no_match");
    expect(r.text).toContain("non sono tra quelle critiche");
  });

  it("accetta sigle italiane e ignora valori sconosciuti", () => {
    expect(normalizeAspects(["no", "O", "x", "n"])).toEqual(["N", "W", "NW"]);
  });

  it("esposizioni ignote e bollettino assente", () => {
    expect(checkRouteAspects([], so3).status).toBe("unknown_route");
    const none = checkRouteAspects(["N"], null);
    expect(none.status).toBe("no_bulletin");
    expect(none.text).toContain("Nessun bollettino");
  });
});

describe("utility", () => {
  it("etichette quota", () => {
    expect(elevationBandLabel({ lower: "2100", upper: null })).toBe("sopra 2100 m");
    expect(elevationBandLabel({ lower: null, upper: "treeline" })).toBe("sotto il limite del bosco");
    expect(elevationBandLabel({ lower: "1800", upper: "2400" })).toBe("tra 1800 m e 2400 m");
    expect(elevationBandLabel({ lower: null, upper: null })).toBe("a tutte le quote");
  });

  it("stripHtml", () => {
    expect(stripHtml("<h1>Tendenza</h1><p>Neve&nbsp;in arrivo</p>")).toBe("Tendenza Neve in arrivo");
    expect(stripHtml("")).toBeNull();
  });

  it("point in polygon con buco e multipolygon", () => {
    const square: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
      ],
    };
    expect(pointInGeometry(1, 1, square)).toBe(true);
    expect(pointInGeometry(5, 5, square)).toBe(false);
    expect(pointInGeometry(11, 5, square)).toBe(false);
    const multi: GeoJSON.MultiPolygon = { type: "MultiPolygon", coordinates: [square.coordinates, [[[20, 20], [21, 20], [21, 21], [20, 20]]]] };
    expect(pointInGeometry(20.8, 20.2, multi)).toBe(true);
  });
});
