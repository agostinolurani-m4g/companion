import {
  countPois,
  getFirstTrack,
  listCheckpoints,
  listCourseBridges,
  listNotableSections,
  listPois,
  listRacePlansWithItems,
  listResupply,
  listTrackSurfaceSegments,
} from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import HmrApp from "@/components/HmrApp";
import LoginGate from "@/components/LoginGate";
import { getCurrentSessionEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RacePage() {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail) return <LoginGate />;

  const track = getFirstTrack();
  if (!track) {
    return (
      <main className="flex h-full flex-col items-center justify-center p-6 text-center">
        <p className="text-sm text-[color:var(--hmr-muted)]">Nessuna traccia nel database. Apri la home e segui le istruzioni di ingest.</p>
      </main>
    );
  }

  const bbox = JSON.parse(track.bbox_json) as {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  const checkpoints = listCheckpoints(track.id);
  const resupply = listResupply(track.id);
  const sections = listNotableSections(track.id);
  const bridges = listCourseBridges(track.id);
  const pois = listPois(track.id);
  const racePlans = listRacePlansWithItems(track.id);
  const surfaceSegments = listTrackSurfaceSegments(track.id);
  void countPois(track.id);

  return (
    <HmrApp
      sessionEmail={sessionEmail}
      initialTab="nextPoi"
      initialRaceActive
      initial={{
        id: track.id,
        name: track.name,
        length_km: track.length_km,
        elev_gain_m: track.elev_gain_m,
        elev_loss_m: track.elev_loss_m,
        elev_profile_gain_scale: Number(track.elev_profile_gain_scale ?? 1),
        elev_profile_loss_scale: Number(track.elev_profile_loss_scale ?? 1),
        bbox,
        coords,
        checkpoints,
        resupply,
        sections,
        bridges,
        pois,
        racePlans,
        surfaceSegments,
      }}
    />
  );
}
