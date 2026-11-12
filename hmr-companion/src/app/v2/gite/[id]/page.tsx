import { redirect } from "next/navigation";
import V2OutingDetail from "@/components/v2/V2OutingDetail";
import { getCurrentSessionEmail, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

export default async function V2OutingPage({ params }: Props) {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");

  const { id } = await params;
  return <V2OutingDetail outingId={id} />;
}
