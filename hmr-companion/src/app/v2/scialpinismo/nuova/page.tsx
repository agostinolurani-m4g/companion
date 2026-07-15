import { Suspense } from "react";
import { redirect } from "next/navigation";
import V2SkiUpload from "@/components/v2/V2SkiUpload";
import { getCurrentSessionEmail, isAdminUser, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2SkiUploadPage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");

  return (
    <Suspense fallback={<div className="p-4 text-sm text-[color:var(--hmr-muted)]">Caricamento…</div>}>
      <V2SkiUpload isAdmin={isAdminUser(sessionEmail)} username={sessionEmail} />
    </Suspense>
  );
}
