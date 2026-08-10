import { hasConfirmedReport, type FieldReportRow } from "@/lib/db";
import { serializeFieldReport } from "@/lib/field-reports";

export function serializeFieldReportForViewer(
  row: FieldReportRow,
  viewerUsername?: string,
) {
  return serializeFieldReport(row, {
    viewer_confirmed: viewerUsername
      ? hasConfirmedReport(row.id, viewerUsername)
      : undefined,
  });
}
