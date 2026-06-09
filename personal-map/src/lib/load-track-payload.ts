import { countPois, getTrack, getTrackForOwner, listPois, listTrackSurfaceSegments } from "@/lib/db";
import type { TrackPayload } from "@/components/PersonalApp";
import type { StoredCoord } from "@/lib/track-coords";

export function loadTrackPayload(trackId: string, ownerId?: string): TrackPayload | null {
  const track = ownerId ? getTrackForOwner(trackId, ownerId) : getTrack(trackId);
  if (!track) return null;

  const bbox = JSON.parse(track.bbox_json) as TrackPayload["bbox"];
  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  void countPois(track.id);

  return {
    id: track.id,
    name: track.name,
    length_km: track.length_km,
    elev_gain_m: track.elev_gain_m,
    elev_loss_m: track.elev_loss_m,
    elev_profile_gain_scale: Number(track.elev_profile_gain_scale ?? 1),
    elev_profile_loss_scale: Number(track.elev_profile_loss_scale ?? 1),
    activity_type: track.activity_type,
    bbox,
    coords,
    pois: listPois(track.id),
    surfaceSegments: listTrackSurfaceSegments(track.id),
  };
}
