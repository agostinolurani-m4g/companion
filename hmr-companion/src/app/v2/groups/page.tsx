import { Suspense } from "react";
import { redirect } from "next/navigation";
import V2Groups from "@/components/v2/V2Groups";
import { getCurrentSessionEmail, isAdminUser, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2GroupsPage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");

  return (
    <Suspense fallback={<p className="p-4 text-sm text-[color:var(--hmr-muted)]">Caricamento…</p>}>
      <V2Groups username={sessionEmail} isAdmin={isAdminUser(sessionEmail)} />
    </Suspense>
  );
}
