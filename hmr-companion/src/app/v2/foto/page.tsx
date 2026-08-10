import { redirect } from "next/navigation";
import V2PhotoPage from "@/components/v2/V2PhotoPage";
import { getCurrentSessionEmail, isAdminUser, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2FotoPageRoute() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");

  return <V2PhotoPage isAdmin={isAdminUser(sessionEmail)} username={sessionEmail} />;
}
