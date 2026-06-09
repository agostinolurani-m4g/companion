import PersonalMapOverview from "@/components/PersonalMapOverview";
import LoginGate from "@/components/LoginGate";
import { getCurrentSessionEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MapOverviewPage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) return <LoginGate />;
  return <PersonalMapOverview />;
}
