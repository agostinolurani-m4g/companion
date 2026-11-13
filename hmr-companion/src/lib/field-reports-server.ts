import { getUserPhoto, hasConfirmedReport, type FieldReportRow } from "@/lib/db";
import { serializeFieldReport } from "@/lib/field-reports";
import { avatarUrl } from "@/lib/social-labels";

export function serializeFieldReportForViewer(
  row: FieldReportRow,
  viewerUsername?: string,
) {
  const photo = row.photo_id ? getUserPhoto(row.photo_id) : undefined;
  return serializeFieldReport(row, {
    viewer_confirmed: viewerUsername
      ? hasConfirmedReport(row.id, viewerUsername)
      : undefined,
    photo_url: avatarUrl(photo?.photo_path),
  });
}
