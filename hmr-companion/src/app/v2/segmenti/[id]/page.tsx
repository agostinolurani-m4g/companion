import { redirect } from "next/navigation";
import V2SegmentDetail from "@/components/v2/V2SegmentDetail";
import { getCurrentSessionEmail, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2SegmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail || !isV2BetaUser(sessionEmail)) redirect("/");
  const { id } = await params;
  return <V2SegmentDetail segmentId={id} />;
}
