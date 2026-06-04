import TrackPicker, { type TrackPickerItem } from "@/components/TrackPicker";
import LoginGate from "@/components/LoginGate";
import { getCurrentSessionEmail } from "@/lib/auth";
import { getIngestCreditsInfo } from "@/lib/ingest-credits";
import { listTracks } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) return <LoginGate />;

  const tracks: TrackPickerItem[] = listTracks().map((t) => ({
    id: t.id,
    name: t.name,
    length_km: t.length_km,
    elev_gain_m: t.elev_gain_m,
    elev_loss_m: t.elev_loss_m,
    point_count: t.point_count,
    created_at: t.created_at,
  }));

  const credits = getIngestCreditsInfo(sessionEmail);

  return <TrackPicker tracks={tracks} credits={credits} />;
}
