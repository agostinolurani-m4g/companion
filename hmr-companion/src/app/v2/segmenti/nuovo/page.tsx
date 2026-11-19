import { redirect } from "next/navigation";
import V2SegmentCreate from "@/components/v2/V2SegmentCreate";
import { getCurrentSessionEmail, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2SegmentCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string; route?: string }>;
}) {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail || !isV2BetaUser(sessionEmail)) redirect("/");
  const sp = await searchParams;
  const source = sp.activity
    ? ({ kind: "activity", id: sp.activity } as const)
    : sp.route
      ? ({ kind: "route", id: sp.route } as const)
      : null;
  return <V2SegmentCreate source={source} />;
}
