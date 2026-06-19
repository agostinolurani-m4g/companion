import { redirect } from "next/navigation";
import V2AdminUsers from "@/components/v2/V2AdminUsers";
import { getCurrentSessionEmail, isAdminUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2AdminPage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isAdminUser(sessionEmail)) redirect("/");

  return <V2AdminUsers />;
}
