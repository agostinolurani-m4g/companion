import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { compactTrack } from "@/lib/activities/geo";
import { ingestActivity } from "@/lib/activities/ingest";
import { migrateActivitiesStore } from "@/lib/activities/store";
import { detectClimbs, matchSegment, segmentStats } from "@/lib/segments/match";
import {
  insertSegment,
  matchSegmentAgainstActivities,
  myEfforts,
  segmentLeaderboard,
  segmentLegends,
} from "@/lib/segments/store";

/** Linea verso nord: `n` punti ogni ~11 m (1e-4° di latitudine), quota in salita del 10%. */
function northLine(lng: number, lat0: number, n: number, ele0 = 1000): GeoJSON.Position[] {
  return Array.from({ length: n }, (_, i) => [lng, lat0 + i * 1e-4, ele0 + i * 1.11]);
}

const SEG = northLine(9.0, 46.0, 100); // ~1.1 km
// Attività: arriva da sud, percorre il segmento e prosegue oltre.
const ACT = northLine(9.0, 45.995, 200);
// Un secondo per 1e-4° → ~11 m/s, ma con una sosta a metà salita.
const ACT_TIMES = ACT.map((_, i) => i * 2);

describe("matchSegment", () => {
  it("trova il passaggio e misura il tempo fra via e arrivo", () => {
    const m = matchSegment(SEG, ACT, ACT_TIMES);
    expect(m).toHaveLength(1);
    // Via all'indice 50 dell'attività, arrivo al 149: 99 vertici × 2 s.
    expect(m[0].elapsed_s).toBeGreaterThan(190);
    expect(m[0].elapsed_s).toBeLessThan(206);
    expect(m[0].start_offset_s).toBeCloseTo(100, -1);
  });

  it("ignora chi tocca solo un estremo o va nell'altro senso", () => {
    const partial = northLine(9.0, 45.995, 90);
    expect(matchSegment(SEG, partial, null)).toHaveLength(0);
    const reversed = [...ACT].reverse();
    expect(matchSegment(SEG, reversed, null)).toHaveLength(0);
  });

  it("ignora una traccia parallela lontana", () => {
    const far = northLine(9.002, 45.995, 200); // ~155 m a est
    expect(matchSegment(SEG, far, null)).toHaveLength(0);
  });

  it("conta due giri distinti sullo stesso segmento", () => {
    const down = northLine(9.0003, 46.0, 100).reverse(); // ritorno a ~23 m
    const twice = [...ACT.slice(0, 150), ...down, ...ACT.slice(50, 150)];
    const times = twice.map((_, i) => i * 3);
    expect(matchSegment(SEG, twice, times)).toHaveLength(2);
  });

  it("senza orari restituisce il passaggio con tempo nullo", () => {
    const m = matchSegment(SEG, ACT, null);
    expect(m).toHaveLength(1);
    expect(m[0].elapsed_s).toBeNull();
  });
});

describe("segmentStats / detectClimbs", () => {
  it("calcola lunghezza, dislivello e pendenza", () => {
    const st = segmentStats(SEG);
    expect(st.length_m).toBeGreaterThan(1080);
    expect(st.length_m).toBeLessThan(1120);
    expect(st.elev_gain_m).toBeGreaterThan(100);
    expect(st.avg_grade_pct).toBeCloseTo(10, 0);
  });

  it("propone la salita dentro un giro piatto-salita-discesa", () => {
    const flat = northLine(9.0, 45.99, 50, 1000).map((c) => [c[0], c[1], 1000]);
    const up = northLine(9.0, 45.995, 100, 1000);
    const down = northLine(9.0, 46.005, 60, 1110).map((c, i) => [c[0], c[1], 1110 - i * 2]);
    const climbs = detectClimbs([...flat, ...up, ...down]);
    expect(climbs).toHaveLength(1);
    expect(climbs[0].gain_m).toBeGreaterThan(100);
  });
});

describe("store: passaggi e classifiche", () => {
  const now = Date.parse("2026-11-01T10:00:00Z");

  function setup() {
    const db = new Database(":memory:");
    migrateActivitiesStore(db);
    return db;
  }

  function addActivity(db: Database.Database, owner: string, start: number, secPerPoint: number, provider: "upload" | "strava" = "upload") {
    const pts = ACT.map((c, i) => ({ lng: c[0], lat: c[1], ele: c[2], t: start + i * secPerPoint * 1000 }));
    const { line, times } = compactTrack(pts);
    return ingestActivity(db, {
      owner,
      provider,
      external_id: `${owner}-${start}`,
      sport: "road",
      name: `Giro ${owner}`,
      start_time: start,
      line,
      times,
      distance_m: 2200,
      elev_gain_m: 200,
      moving_time_s: 400,
      community_consent: true,
      now,
    });
  }

  it("classifica tempi, Local Legend e visibilità Strava", () => {
    const db = setup();
    // Prima le attività, poi il segmento (scansione retroattiva)…
    addActivity(db, "ale", now - 5 * 86400e3, 2);
    addActivity(db, "ale", now - 3 * 86400e3, 3);
    addActivity(db, "ale", now - 1 * 86400e3, 3);
    addActivity(db, "gala", now - 2 * 86400e3, 1.5, "strava");
    const seg = insertSegment(db, { owner: "ale", name: "Salita test", sport: "road", coords: SEG, visibility: "public", now });
    expect(matchSegmentAgainstActivities(db, seg, now)).toBe(4);
    // …poi un'attività nuova viene abbinata all'import.
    addActivity(db, "marti", now - 4 * 86400e3, 2.5);

    const forAle = segmentLeaderboard(db, seg.id, "ale");
    // gala è su Strava: non visibile agli altri.
    expect(forAle.map((e) => e.owner)).toEqual(["ale", "marti"]);
    const forGala = segmentLeaderboard(db, seg.id, "gala");
    expect(forGala[0].owner).toBe("gala");

    const legends = segmentLegends(db, seg.id, "ale", now);
    expect(legends[0]).toMatchObject({ owner: "ale", efforts: 3, rank: 1 });

    const mine = myEfforts(db, seg.id, "ale");
    expect(mine).toHaveLength(3);
    expect(mine.every((e) => e.elapsed_s != null)).toBe(true);
  });
});
