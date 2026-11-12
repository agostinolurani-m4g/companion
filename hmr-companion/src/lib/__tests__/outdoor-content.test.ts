import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { classifyOutdoor } from "@/lib/outdoor/taxonomy";
import { formatOpeningHours, keyFactsFromTags } from "@/lib/outdoor/tag-labels";
import {
  migrateOutdoorStore,
  queryOutdoorFeaturesInBbox,
  searchOutdoorFeatures,
  setDemElevation,
  upsertOutdoorFeature,
  deleteOutdoorFeature,
} from "@/lib/outdoor/store";
import {
  cleanRefugesInfoText,
  parseRefugesInfoResponse,
  refugesInfoKind,
  summarizeRefugesInfo,
} from "@/lib/outdoor/sources/refuges-info";
import { fullyCoveredTilesZ10, coverageCellKey, kindAllowed, parseTrailMode } from "@/lib/outdoor/pbf-filter";
import { tileBbox } from "@/lib/outdoor/tiles";

describe("keyFactsFromTags — rifugi", () => {
  const facts = keyFactsFromTags({
    tourism: "alpine_hut",
    ele: "2350",
    beds: "40",
    winter_room: "yes",
    "capacity:winter_room": "8",
    opening_hours: "Jun 20-Sep 20",
    reservation: "recommended",
    drinking_water: "yes",
    operator: "CAI Milano",
    "contact:phone": "+39 0342 123456; +39 333 1234567",
    "contact:website": "https://www.rifugio.example/",
    email: "info@rifugio.example",
  });
  const by = (k: string) => facts.find((f) => f.key === k);

  it("posti letto da beds se manca capacity", () => {
    expect(by("capacity")).toMatchObject({ label: "Posti letto", value: "40" });
  });
  it("locale invernale con posti", () => {
    expect(by("winter_room")?.value).toBe("Sì · 8 posti");
  });
  it("apertura tradotta, prenotazione, acqua, gestore", () => {
    expect(by("opening_hours")?.value).toBe("giu 20-set 20");
    expect(by("reservation")?.value).toBe("Consigliata");
    expect(by("drinking_water")?.value).toBe("Sì");
    expect(by("operator")?.value).toBe("CAI Milano");
  });
  it("contatti da contact:* con href", () => {
    expect(by("phone")).toMatchObject({ value: "+39 0342 123456 · +39 333 1234567", href: "tel:+390342123456" });
    expect(by("website")).toMatchObject({ value: "rifugio.example", href: "https://www.rifugio.example/" });
    expect(by("email")?.href).toBe("mailto:info@rifugio.example");
  });
  it("locale invernale assente e capacity prioritaria", () => {
    const f = keyFactsFromTags({ capacity: "12", beds: "10", winter_room: "no", website: "rifugio.it" });
    expect(f.find((x) => x.key === "capacity")?.value).toBe("12");
    expect(f.find((x) => x.key === "winter_room")?.value).toBe("No");
    expect(f.find((x) => x.key === "website")?.href).toBe("https://rifugio.it");
  });
  it("opening_hours speciali", () => {
    expect(formatOpeningHours("24/7")).toBe("Sempre aperto");
    expect(formatOpeningHours("Mo-Fr 08:00-18:00;Su off")).toBe("lun-ven 08:00-18:00; dom chiuso");
  });
});

describe("taxonomy — rifugi mappati come edificio", () => {
  it("way tourism=alpine_hut diventa punto", () => {
    expect(classifyOutdoor("way", { tourism: "alpine_hut", building: "yes" })).toEqual({
      group: "shelter",
      kind: "alpine_hut",
      geom: "point",
    });
    expect(classifyOutdoor("way", { amenity: "shelter", shelter_type: "basic_hut" })?.kind).toBe("shelter_basic");
  });
  it("way non outdoor e sentieri invariati", () => {
    expect(classifyOutdoor("way", { amenity: "parking" })).toBeNull();
    expect(classifyOutdoor("way", { highway: "path" })?.kind).toBe("path_hiking");
  });
});

describe("refuges.info", () => {
  const sample = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: 377,
        geometry: { type: "Point", coordinates: [7.02403, 45.86902] },
        properties: {
          nom: "Bivouac de Frébouze",
          type: { id: 7, valeur: "cabane non gardée" },
          id: 377,
          coord: { alt: 2360, long: 7.02403, lat: 45.86902 },
          etat: { valeur: "Détruite" },
          places: { valeur: 0 },
          lien: "https://www.refuges.info/point/377/cabane-non-gardee/bivouac-de-Frebouze/",
          date: { derniere_modif: "2025-09-24 08:48:44.948208+02" },
          proprio: { valeur: "CAI" },
          info_comp: {
            eau: { valeur: "Non" },
            poele: { valeur: "Inconnu" },
            couvertures: { valeur: "Oui" },
            places: { valeur: "Inconnu" },
          },
        },
      },
      { type: "Feature", properties: { nom: "senza coordinate" } },
    ],
  };

  it("analizza il GeoJSON attuale e scarta feature non valide", () => {
    const places = parseRefugesInfoResponse(sample);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      id: 377,
      typeId: 7,
      altitude: 2360,
      places: 0,
      water: false,
      stove: null,
      blankets: true,
      state: "Détruite",
      owner: "CAI",
    });
  });

  it("riepilogo in italiano", () => {
    const s = summarizeRefugesInfo(parseRefugesInfoResponse(sample)[0]);
    expect(s?.state).toBe("Distrutto");
    expect(s?.type).toContain("Bivacco");
    expect(s?.facts).toEqual(
      expect.arrayContaining([
        { label: "Acqua entro 100 m", value: "No" },
        { label: "Coperte", value: "Sì" },
      ]),
    );
    expect(s?.updatedAt).toBe("2025-09-24");
    expect(summarizeRefugesInfo({ url: "x" })).toBeNull();
  });

  it("ripulisce il BBCode", () => {
    expect(cleanRefugesInfoText("Vedi [url=http://x.ch/] il sito [/url] e il [->372].\r\n\r\n[b]Ok[/b]")).toBe(
      "Vedi il sito e il punto refuges.info 372.\nOk",
    );
    expect(cleanRefugesInfoText("a".repeat(20), 10)).toBe("aaaaaaaaa…");
  });

  it("mappa i tipi", () => {
    expect(refugesInfoKind(10)?.kind).toBe("alpine_hut");
    expect(refugesInfoKind(23)?.grp).toBe("water");
    expect(refugesInfoKind(3)).toBeNull();
  });
});

describe("pbf-filter", () => {
  it("modalità trail", () => {
    expect(parseTrailMode(undefined)).toBe("hiking");
    expect(() => parseTrailMode("boh")).toThrow();
    const ex = new Set(["bench"]);
    expect(kindAllowed("trail", "path_hiking", "hiking", ex)).toBe(true);
    expect(kindAllowed("trail", "footway", "hiking", ex)).toBe(false);
    expect(kindAllowed("trail", "footway", "all", ex)).toBe(true);
    expect(kindAllowed("trail", "track", "none", ex)).toBe(false);
    expect(kindAllowed("shelter", "alpine_hut", "none", ex)).toBe(true);
    expect(kindAllowed("service", "bench", "all", ex)).toBe(false);
  });

  it("marca solo tile z10 interni e con tutte le celle coperte", () => {
    const t = tileBbox(10, 538, 362);
    const bbox = { west: t.west - 0.5, south: t.south - 0.5, east: t.east + 0.5, north: t.north + 0.5 };
    const cells = new Set<number>();
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const lng = t.west + ((i + 0.5) / steps) * (t.east - t.west);
        const lat = t.south + ((j + 0.5) / steps) * (t.north - t.south);
        cells.add(coverageCellKey(lng, lat));
      }
    }
    expect(fullyCoveredTilesZ10(bbox, cells)).toEqual([{ x: 538, y: 362 }]);
    cells.delete([...cells][0]!);
    expect(fullyCoveredTilesZ10(bbox, cells)).toEqual([]);
  });
});

describe("store — quota DEM, FTS per rowid, rtree", () => {
  it("conserva la quota DEM al re-import e cancella righe collegate", () => {
    const db = new Database(":memory:");
    migrateOutdoorStore(db);
    const base = {
      osmType: "node" as const,
      osmId: 42,
      grp: "shelter",
      kind: "wilderness_hut",
      name: "Bivacco Prova",
      lat: 46.3,
      lng: 9.4,
      tags: { name: "Bivacco Prova" },
    };
    upsertOutdoorFeature(db, base);
    expect(setDemElevation(db, "n42", 2410)).toBe(true);
    expect(setDemElevation(db, "n42", 1)).toBe(false);
    upsertOutdoorFeature(db, { ...base, name: "Bivacco Prova 2" });
    const row = db.prepare(`SELECT ele, ele_source FROM outdoor_features WHERE id='n42'`).get();
    expect(row).toEqual({ ele: 2410, ele_source: "dem" });
    upsertOutdoorFeature(db, { ...base, ele: 2450, tags: { ele: "2450" } });
    expect(db.prepare(`SELECT ele, ele_source FROM outdoor_features WHERE id='n42'`).get()).toEqual({
      ele: 2450,
      ele_source: "osm",
    });

    expect(searchOutdoorFeatures(db, "Prova")).toHaveLength(1);
    expect(
      queryOutdoorFeaturesInBbox(db, { south: 46.2, west: 9.3, north: 46.4, east: 9.5, zoom: 14 }),
    ).toHaveLength(1);
    expect(deleteOutdoorFeature(db, "n42")).toBe(true);
    expect(searchOutdoorFeatures(db, "Prova")).toHaveLength(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM outdoor_features_rtree`).get()).toEqual({ n: 0 });
  });

  it("migra un DB legacy (rtree tabella normale, FTS non allineato)", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE outdoor_features (id TEXT PRIMARY KEY, osm_type TEXT NOT NULL, osm_id INTEGER NOT NULL,
        grp TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', lat REAL NOT NULL, lng REAL NOT NULL,
        ele REAL, tags_json TEXT NOT NULL DEFAULT '{}', geom_json TEXT, source TEXT NOT NULL DEFAULT 'osm',
        updated_at INTEGER NOT NULL, UNIQUE(osm_type, osm_id));
      CREATE VIRTUAL TABLE outdoor_features_fts USING fts5(feature_id UNINDEXED, name, ref, kind);
      CREATE TABLE outdoor_features_rtree (id INTEGER PRIMARY KEY, minLat REAL NOT NULL, maxLat REAL NOT NULL,
        minLng REAL NOT NULL, maxLng REAL NOT NULL);
      INSERT INTO outdoor_features VALUES ('n1','node',1,'terrain','peak','Pizzo Legacy',46.3,9.4,3000,'{"ref":"X1"}',NULL,'overpass',1);
      INSERT INTO outdoor_features_rtree VALUES (1,46.3,46.3,9.4,9.4);
      INSERT INTO outdoor_features_fts(rowid, feature_id, name, ref, kind) VALUES (77,'n1','Pizzo Legacy','','peak');
    `);
    migrateOutdoorStore(db);
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE name='outdoor_features_rtree'`).get() as {
      sql: string;
    }).sql;
    expect(sql).toMatch(/rtree/i);
    expect(db.prepare(`SELECT rowid, ref FROM outdoor_features_fts`).all()).toEqual([{ rowid: 1, ref: "X1" }]);
    expect(db.prepare(`SELECT ele_source FROM outdoor_features`).get()).toEqual({ ele_source: "osm" });
    expect(
      queryOutdoorFeaturesInBbox(db, { south: 46.2, west: 9.3, north: 46.4, east: 9.5, zoom: 14 }),
    ).toHaveLength(1);
  });
});
