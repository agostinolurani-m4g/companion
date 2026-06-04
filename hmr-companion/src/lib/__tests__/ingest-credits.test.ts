import { describe, expect, it } from "vitest";
import { isUnlimitedIngestUser, UNLIMITED_INGEST_USERS } from "../ingest-credits";

describe("ingest credits", () => {
  it("ago è illimitato", () => {
    expect(UNLIMITED_INGEST_USERS.has("ago")).toBe(true);
    expect(isUnlimitedIngestUser("ago")).toBe(true);
    expect(isUnlimitedIngestUser("Ale")).toBe(false);
  });
});
