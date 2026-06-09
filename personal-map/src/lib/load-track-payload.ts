import {
  countPois,
  getTrack,
  getTrackForOwner,
  listJournalEntries,
  listPois,
  listTrackDifficultySegments,
  listTrackSurfaceSegments,
} from "@/lib/db";
import type { TrackPayload } from "@/components/PersonalApp";
import type { StoredCoord } from "@/lib/track-coords";
import { inferSportMode, type SportMode } from "@/lib/sport-modes";
import { analyzeTrackDifficulty, difficultyToNotableSections } from "@/lib/analyze-track-difficulty";

export function loadTrackPayload(trackId: string, ownerId?: string): TrackPayload | null {
  const track = ownerId ? getTrackForOwner(trackId, ownerId) : getTrack(trackId);
  if (!track) return null;

  const bbox = JSON.parse(track.bbox_json) as TrackPayload["bbox"];
  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  void countPois(track.id);

  let difficultySegments = listTrackDifficultySegments(track.id);
  let grade: string | null = null;
  if (difficultySegments.length === 0 && coords.length >= 2) {
    try {
      const analyzed = analyzeTrackDifficulty(track.id);
      difficultySegments = analyzed.segments;
      grade = analyzed.grade;
    } catch {
      /* best effort */
    }
  }

  const sportMode: SportMode =
    (track.sport_mode as SportMode | null) ?? inferSportMode(track.activity_type);

  return {
    id: track.id,
    name: track.name,
    length_km: track.length_km,
    elev_gain_m: track.elev_gain_m,
    elev_loss_m: track.elev_loss_m,
    elev_profile_gain_scale: Number(track.elev_profile_gain_scale ?? 1),
    elev_profile_loss_scale: Number(track.elev_profile_loss_scale ?? 1),
    activity_type: track.activity_type,
    sport_mode: sportMode,
    journal_summary: track.journal_summary ?? null,
    source: track.source,
    grade,
    bbox,
    coords,
    pois: listPois(track.id),
    surfaceSegments: listTrackSurfaceSegments(track.id),
    difficultySegments,
    journalEntries: listJournalEntries(track.id),
    notableSections: difficultyToNotableSections(difficultySegments),
  };
}
