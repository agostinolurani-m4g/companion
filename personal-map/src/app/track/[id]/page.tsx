import { notFound } from "next/navigation";
import PersonalApp from "@/components/PersonalApp";
import LoginGate from "@/components/LoginGate";
import { getCurrentSessionEmail } from "@/lib/auth";
import { loadTrackPayload } from "@/lib/load-track-payload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

export default async function TrackPage({ params }: Props) {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) return <LoginGate />;

  const { id } = await params;
  const initial = loadTrackPayload(id, sessionEmail);
  if (!initial) notFound();

  return <PersonalApp sessionEmail={sessionEmail} initial={initial} />;
}
