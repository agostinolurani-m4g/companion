import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { pointsAlongRoute, routeBbox, routeLengthKm } from "@/lib/geo-along";
import {
  deleteHighlight,
  insertHighlight,
  listHighlightsInBbox,
  migrateHighlights,
  toggleHighlightVote,
} from "@/lib/highlights/store";

const now = Date.parse("2026-11-01T10:00:00Z");

describe("highlights", () => {
  function setup() {
    const db = new Database(":memory:");
    migrateHighlights(db);
    return db;
  }

  it("crea, vota, filtra per sport, cancella solo l'autore", () => {
    const db = setup();
    const h = insertHighlight(db, { owner: "ale", name: "Belvedere", tip: "Al tramonto", sport: "", lat: 46.3, lng: 9.4, now });
    insertHighlight(db, { owner: "ale", name: "Single track", tip: "", sport: "mtb", lat: 46.31, lng: 9.41, now });
    expect(h.votes).toBe(1);
    expect(h.voted).toBe(1);

    const v = toggleHighlightVote(db, h.id, "marti", now)!;
    expect(v.votes).toBe(2);
    expect(v.voted).toBe(1);
    expect(toggleHighlightVote(db, h.id, "marti", now)!.votes).toBe(1);

    const box = { south: 46.2, west: 9.3, north: 46.4, east: 9.5 };
    expect(listHighlightsInBbox(db, "marti", box)).toHaveLength(2);
    expect(listHighlightsInBbox(db, "marti", box, { sport: "hike" }).map((x) => x.name)).toEqual(["Belvedere"]);

    expect(deleteHighlight(db, h.id, "marti")).toBe(false);
    expect(deleteHighlight(db, h.id, "ale")).toBe(true);
    expect(listHighlightsInBbox(db, "ale", box)).toHaveLength(1);
  });
});

describe("punti lungo il percorso", () => {
  // Percorso verso est di ~1.55 km a 46°N.
  const route: [number, number][] = [
    [9.0, 46.0],
    [9.01, 46.0],
    [9.02, 46.0],
  ];

  it("ordina per km e scarta i punti lontani", () => {
    const pts = [
      { id: "b", lng: 9.015, lat: 46.0 + 100 / 111_320 }, // 100 m a nord, a metà
      { id: "a", lng: 9.002, lat: 46.0 },
      { id: "far", lng: 9.01, lat: 46.01 }, // ~1.1 km
    ];
    const hits = pointsAlongRoute(route, pts, 300);
    expect(hits.map((h) => h.item.id)).toEqual(["a", "b"]);
    expect(hits[1].distM).toBeGreaterThan(90);
    expect(hits[1].distM).toBeLessThan(110);
    expect(hits[1].alongKm).toBeCloseTo(routeLengthKm(route) * 0.75, 1);
  });

  it("bbox del percorso con margine", () => {
    const [s, w, n, e] = routeBbox(route, 300);
    expect(s).toBeLessThan(46);
    expect(n).toBeGreaterThan(46);
    expect(w).toBeLessThan(9);
    expect(e).toBeGreaterThan(9.02);
  });
});
