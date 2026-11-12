import { redirect } from "next/navigation";
import V2Safety from "@/components/v2/V2Safety";
import { getCurrentSessionEmail, isAdminUser, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SicurezzaPage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");
  return <V2Safety isAdmin={isAdminUser(sessionEmail)} username={sessionEmail} />;
}
