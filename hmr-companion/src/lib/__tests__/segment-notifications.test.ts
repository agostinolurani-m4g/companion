import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { compactTrack } from "@/lib/activities/geo";
import { ingestActivity } from "@/lib/activities/ingest";
import { migrateActivitiesStore } from "@/lib/activities/store";
import { listNotifications, markNotificationsRead, unreadCount } from "@/lib/notifications";
import { detectDescents, segmentKind, segmentStats } from "@/lib/segments/match";
import {
  insertSegment,
  matchSegmentAgainstActivities,
  segmentLeaderboard,
  setAthleteGender,
} from "@/lib/segments/store";

function northLine(lng: number, lat0: number, n: number, ele0 = 1000, grade = 1.11): GeoJSON.Position[] {
  return Array.from({ length: n }, (_, i) => [lng, lat0 + i * 1e-4, ele0 + i * grade]);
}

const SEG = northLine(9.0, 46.0, 100);
const ACT = northLine(9.0, 45.995, 200);
const now = Date.parse("2026-11-01T10:00:00Z");

function setup() {
  const db = new Database(":memory:");
  migrateActivitiesStore(db);
  return db;
}

function ride(db: Database.Database, owner: string, start: number, secPerPoint: number) {
  const pts = ACT.map((c, i) => ({ lng: c[0], lat: c[1], ele: c[2], t: start + i * secPerPoint * 1000 }));
  const { line, times } = compactTrack(pts);
  return ingestActivity(db, {
    owner,
    provider: "upload",
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

describe("notifiche segmenti", () => {
  it("record personale, corona presa e persa; nessuna notifica dalla scansione retroattiva", () => {
    const db = setup();
    ride(db, "ale", now - 10 * 86400e3, 3);
    const seg = insertSegment(db, { owner: "ale", name: "Salita test", sport: "road", coords: SEG, visibility: "public", now });
    matchSegmentAgainstActivities(db, seg, now);
    expect(unreadCount(db, "ale")).toBe(0);

    // ale migliora: nuovo record personale (era già in testa, niente corona "presa").
    ride(db, "ale", now - 5 * 86400e3, 2.5);
    expect(listNotifications(db, "ale").map((n) => n.kind)).toEqual(["segment_pr"]);

    // marti va più forte: corona a marti, ale la perde.
    ride(db, "marti", now - 2 * 86400e3, 2);
    expect(listNotifications(db, "marti").map((n) => n.kind)).toEqual(["segment_crown"]);
    const lost = listNotifications(db, "ale").find((n) => n.kind === "segment_crown_lost");
    expect(lost?.title).toMatch(/perso la corona/);
    expect(lost?.href).toBe(`/v2/segmenti/${seg.id}`);

    markNotificationsRead(db, "ale", now);
    expect(unreadCount(db, "ale")).toBe(0);
  });

  it("classifica per genere (facoltativo)", () => {
    const db = setup();
    ride(db, "ale", now - 3 * 86400e3, 2);
    ride(db, "giulia", now - 2 * 86400e3, 2.5);
    const seg = insertSegment(db, { owner: "ale", name: "S", sport: "road", coords: SEG, visibility: "public", now });
    matchSegmentAgainstActivities(db, seg, now);
    setAthleteGender(db, "giulia", "f", now);
    expect(segmentLeaderboard(db, seg.id, "ale").map((e) => e.owner)).toEqual(["ale", "giulia"]);
    expect(segmentLeaderboard(db, seg.id, "ale", { gender: "f" }).map((e) => e.owner)).toEqual(["giulia"]);
    expect(segmentLeaderboard(db, seg.id, "ale", { gender: "m" })).toEqual([]);
  });
});

describe("segmenti in discesa", () => {
  it("riconosce discese e tipo di segmento", () => {
    const down = northLine(9.0, 46.0, 120, 1500, -1.5);
    const flat = northLine(9.0, 45.99, 60, 1500, 0);
    const descents = detectDescents([...flat, ...down]);
    expect(descents).toHaveLength(1);
    expect(descents[0].gain_m).toBeGreaterThan(150);
    expect(segmentKind(segmentStats(down))).toBe("descent");
    expect(segmentKind(segmentStats(SEG))).toBe("climb");
    expect(segmentKind(segmentStats(flat))).toBe("flat");
  });

  it("salva tipo e perdita di quota", () => {
    const db = setup();
    const seg = insertSegment(db, {
      owner: "ale",
      name: "Discesa",
      sport: "mtb",
      coords: northLine(9.0, 46.0, 120, 1500, -1.5),
      visibility: "public",
      now,
    });
    expect(seg.kind).toBe("descent");
    expect(seg.elev_loss_m).toBeGreaterThan(150);
  });
});
