import { describe, expect, it } from "vitest";
import { formatOutingDate } from "../ski-outings-types";
import { serializeSkiOuting } from "../ski-outings";
import type { SkiOutingRow } from "../db";

describe("ski-outings helpers", () => {
  it("formats outing dates in Italian", () => {
    expect(formatOutingDate("2026-01-15")).toMatch(/15/);
    expect(formatOutingDate(null)).toBe("Data non indicata");
  });

  it("serializes outing with participants and groups", () => {
    const row: SkiOutingRow = {
      id: "o1",
      route_id: "r1",
      owner: "alice",
      title: "Test",
      outing_date: "2026-02-01",
      snow_notes: "neve buona",
      created_at: 1,
      updated_at: 2,
    };
    const dto = serializeSkiOuting(row);
    expect(dto.id).toBe("o1");
    expect(dto.participants).toEqual([]);
    expect(dto.group_ids).toEqual([]);
  });
});
