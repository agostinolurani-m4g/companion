import { redirect } from "next/navigation";
import { getCurrentSessionEmail, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function V2ExplorePage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");
  redirect("/v2/plan?mode=explore");
}
