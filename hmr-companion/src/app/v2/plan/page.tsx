import { Suspense } from "react";
import { redirect } from "next/navigation";
import V2RouteBuilder from "@/components/v2/V2RouteBuilder";
import { getCurrentSessionEmail, isAdminUser, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2PlanPage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");

  return (
    <Suspense fallback={<div className="p-4 text-sm text-[color:var(--hmr-muted)]">Caricamento…</div>}>
      <V2RouteBuilder isAdmin={isAdminUser(sessionEmail)} />
    </Suspense>
  );
}
