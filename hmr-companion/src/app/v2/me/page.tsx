import { redirect } from "next/navigation";
import V2MyRoutes from "@/components/v2/V2MyRoutes";
import { getCurrentSessionEmail, isAdminUser, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2MePage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");

  return <V2MyRoutes isAdmin={isAdminUser(sessionEmail)} username={sessionEmail} />;
}
