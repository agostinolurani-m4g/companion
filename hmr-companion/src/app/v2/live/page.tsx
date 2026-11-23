import { redirect } from "next/navigation";
import V2Live from "@/components/v2/V2Live";
import { getCurrentSessionEmail, isV2BetaUser, normalizeUsername, V2_BETA_USERS } from "@/lib/auth";
import { HMR_OFFICIAL_TRACK_ID } from "@/lib/track-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { searchParams: Promise<{ track?: string; km?: string }> };

export default async function V2LivePage({ searchParams }: Props) {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail || !isV2BetaUser(sessionEmail)) redirect("/");
  const me = normalizeUsername(sessionEmail);
  const sp = await searchParams;
  const km = Number(sp.km);
  return (
    <V2Live
      me={me}
      friends={[...V2_BETA_USERS].filter((u) => u !== me)}
      trackId={sp.track?.trim() || HMR_OFFICIAL_TRACK_ID}
      startKm={Number.isFinite(km) && km >= 0 ? km : 12}
    />
  );
}
