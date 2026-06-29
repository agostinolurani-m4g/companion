import { redirect } from "next/navigation";
import V2GroupDetail from "@/components/v2/V2GroupDetail";
import { getCurrentSessionEmail, isAdminUser, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

export default async function V2GroupPage({ params }: Props) {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");

  const { id } = await params;

  return (
    <V2GroupDetail
      groupId={id}
      username={sessionEmail}
      isAdmin={isAdminUser(sessionEmail)}
    />
  );
}
