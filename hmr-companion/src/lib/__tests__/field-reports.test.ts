import { describe, expect, it } from "vitest";
import { REPORT_KIND_LABELS, serializeFieldReport, type FieldReportKind } from "../field-reports";

describe("field-reports", () => {
  it("labels all report kinds in Italian", () => {
    expect(REPORT_KIND_LABELS.avalanche).toBe("Valanga");
    expect(REPORT_KIND_LABELS.road_closed).toBe("Strada chiusa");
  });

  it("marks report verified at 2+ confirmations", () => {
    const row = {
      id: "r1",
      author: "alice",
      lng: 9.1,
      lat: 46.0,
      kind: "steep",
      description: "molto ripido",
      route_id: null,
      status: "active",
      confirmation_count: 2,
      created_at: 1,
      updated_at: 2,
    };
    const dto = serializeFieldReport(row);
    expect(dto.verified).toBe(true);
    expect(dto.kind_label).toBe("Ripido");
  });
});
