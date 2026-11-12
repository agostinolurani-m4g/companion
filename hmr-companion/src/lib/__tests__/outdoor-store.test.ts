import { describe, expect, it, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { migrateOutdoorStore, searchOutdoorFeatures, upsertOutdoorFeature } from "@/lib/outdoor/store";

describe("outdoor store FTS", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(":memory:");
    migrateOutdoorStore(db);
    upsertOutdoorFeature(db, {
      osmType: "node",
      osmId: 1,
      grp: "shelter",
      kind: "wilderness_hut",
      name: "Bivacco Chiavenna",
      lat: 46.3,
      lng: 9.4,
      tags: { ref: "CAI 101", name: "Bivacco Chiavenna" },
    });
  });

  it("trova per nome", () => {
    const hits = searchOutdoorFeatures(db, "Chiavenna");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toContain("Chiavenna");
  });
});
