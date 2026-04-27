import {
  countPois,
  getFirstTrack,
  listCheckpoints,
  listNotableSections,
  listPois,
  listRacePlansWithItems,
  listResupply,
  listTrackSurfaceSegments,
} from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import HmrApp from "@/components/HmrApp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  const track = getFirstTrack();
  if (!track) return <EmptyState />;

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
  const pois = listPois(track.id);
  const racePlans = listRacePlansWithItems(track.id);
  const surfaceSegments = listTrackSurfaceSegments(track.id);
  const _poiCount = countPois(track.id);
  void _poiCount;

  return (
    <HmrApp
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
        pois,
        racePlans,
        surfaceSegments,
      }}
    />
  );
}

function EmptyState() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">HMR Companion</h1>
      <p className="max-w-md text-sm text-[color:var(--hmr-muted)]">
        Nessuna traccia è stata ancora importata nel database locale. Dalla root del
        progetto <code className="rounded bg-[color:var(--hmr-elev)] px-1 py-0.5">hmr-companion/</code>{" "}
        esegui:
      </p>
      <pre className="hmr-panel whitespace-pre-wrap px-4 py-3 text-left text-xs">
        npm install
        {"\n"}cp .env.example .env.local
        {"\n"}        npm run ingest
        {"\n"}npm run snapshot
        {"\n"}npm run snapshot:surface
        {"\n"}npm run dev
      </pre>
      <p className="max-w-md text-xs text-[color:var(--hmr-faint)]">
        <strong>ingest</strong> importa il GPX ufficiale + checkpoint/resupply dal manuale.{" "}
        <strong>snapshot</strong> scarica i POI OpenStreetMap lungo il percorso (richiede
        rete e ~10-20 minuti). <strong>snapshot:surface</strong> stima asfalto/sterrato/single
        dai way OSM (rete, ~5-15 minuti).
      </p>
    </main>
  );
}
