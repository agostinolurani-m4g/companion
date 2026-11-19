import { redirect } from "next/navigation";
import V2Segments from "@/components/v2/V2Segments";
import { getCurrentSessionEmail, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2SegmentsPage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail || !isV2BetaUser(sessionEmail)) redirect("/");
  return <V2Segments />;
}
