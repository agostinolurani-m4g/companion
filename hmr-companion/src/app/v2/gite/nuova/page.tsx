import { Suspense } from "react";
import { redirect } from "next/navigation";
import V2OutingUpload from "@/components/v2/V2OutingUpload";
import { getCurrentSessionEmail, isAdminUser, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Aggiungi gita (già fatta) per qualsiasi sport: `?activity=<sport>&group=<id gruppo>`. */
export default async function V2OutingNewPage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");

  return (
    <Suspense fallback={<div className="p-4 text-sm text-[color:var(--hmr-muted)]">Caricamento…</div>}>
      <V2OutingUpload isAdmin={isAdminUser(sessionEmail)} username={sessionEmail} />
    </Suspense>
  );
}
