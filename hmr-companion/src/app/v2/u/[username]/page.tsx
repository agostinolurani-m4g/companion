import { redirect } from "next/navigation";
import V2Profile from "@/components/v2/V2Profile";
import { getCurrentSessionEmail, isAdminUser, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ username: string }> };

export default async function V2UserProfilePage({ params }: Props) {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) redirect("/");
  if (!isV2BetaUser(sessionEmail)) redirect("/");

  const { username } = await params;

  return (
    <V2Profile
      username={username.trim().toLowerCase()}
      isAdmin={isAdminUser(sessionEmail)}
    />
  );
}
