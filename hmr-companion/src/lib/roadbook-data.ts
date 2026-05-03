import {
  getTrack,
  listCheckpoints,
  listNotableSections,
  listPois,
  listRacePlansWithItems,
  listResupply,
  listTrackSurfaceSegments,
  type RacePlanItemRow,
} from "@/lib/db";
import type { BuildRoadbookChunksInput } from "@/lib/roadbook-chunk";
import type { StoredCoord } from "@/lib/track-coords";

function mergeRacePlanItems(trackId: string): RacePlanItemRow[] {
  const plans = listRacePlansWithItems(trackId);
  return plans
    .flatMap((p) => p.items)
    .sort((a, b) => a.km_start - b.km_start || a.id.localeCompare(b.id));
}

export function loadRoadbookChunksInput(trackId: string): BuildRoadbookChunksInput | null {
  const track = getTrack(trackId);
  if (!track) return null;
  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  const surfaceRows = listTrackSurfaceSegments(trackId);
  const surfaceSegments = surfaceRows.map((s) => ({
    km_start: s.km_start,
    km_end: s.km_end,
    surface: s.surface,
  }));

  return {
    lengthKm: track.length_km,
    coords,
    surfaceSegments,
    pois: listPois(trackId),
    checkpoints: listCheckpoints(trackId),
    resupply: listResupply(trackId),
    notableSections: listNotableSections(trackId),
    racePlanItems: mergeRacePlanItems(trackId),
  };
}
