import { describe, expect, it } from "vitest";
import { expiresAtForKind, REPORT_KIND_TTL_MS } from "@/lib/field-reports";

describe("conditions helpers", () => {
  it("storm reports expire in 3 hours", () => {
    const t0 = 1_000_000;
    const exp = expiresAtForKind("storm", t0);
    expect(exp).toBe(t0 + REPORT_KIND_TTL_MS.storm!);
  });

  it("trail decommissioned has no expiry", () => {
    expect(expiresAtForKind("trail_decommissioned", Date.now())).toBeNull();
  });
});
