import { notFound } from "next/navigation";
import HmrApp from "@/components/HmrApp";
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
  const initial = loadTrackPayload(id);
  if (!initial) notFound();

  return <HmrApp sessionEmail={sessionEmail} initial={initial} />;
}
