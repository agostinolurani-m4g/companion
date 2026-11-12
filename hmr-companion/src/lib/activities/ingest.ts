import type Database from "better-sqlite3";
import { syncActivityHeat } from "./heatmap";
import { compactLine } from "./geo";
import { computeTrackStats, uploadExternalId, type ParsedTrack } from "./parse-files";
import { getActivity, insertActivity, type ActivityProvider, type ActivityReviewState } from "./store";

/** Le uscite recenti finiscono nella card "Da rivedere" per proporre contributi alla community. */
export const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function initialReviewState(startTime: number, now: number): ActivityReviewState {
  return now - startTime <= REVIEW_WINDOW_MS ? "pending" : "done";
}

export type IngestInput = {
  owner: string;
  provider: ActivityProvider;
  external_id: string;
  sport: string;
  name: string;
  start_time: number;
  line: GeoJSON.LineString;
  distance_m: number;
  elev_gain_m: number;
  moving_time_s: number | null;
  community_consent: boolean;
  meta?: Record<string, unknown> | null;
  now: number;
};

/** Inserisce (dedup) e aggiorna la heatmap. */
export function ingestActivity(db: Database.Database, input: IngestInput): { id: string; inserted: boolean } {
  if (input.line.coordinates.length < 2) throw new Error("Traccia troppo corta");
  const res = insertActivity(db, {
    ...input,
    review_state: initialReviewState(input.start_time, input.now),
  });
  if (res.inserted) {
    const row = getActivity(db, res.id);
    if (row) syncActivityHeat(db, row);
  }
  return res;
}

export type UploadIngestSummary = {
  imported: number;
  duplicates: number;
  skipped: { fileName: string; reason: string }[];
  ids: string[];
};

/** Import di tracce da file (GPX/TCX/FIT/ZIP già analizzati). */
export function ingestUploadedTracks(
  db: Database.Database,
  owner: string,
  tracks: ParsedTrack[],
  opts: { defaultSport: string; communityConsent: boolean; now: number },
): UploadIngestSummary {
  const out: UploadIngestSummary = { imported: 0, duplicates: 0, skipped: [], ids: [] };
  for (const t of tracks) {
    const stats = computeTrackStats(t.points);
    if (stats.distance_m < 100) {
      out.skipped.push({ fileName: t.fileName, reason: "Traccia più corta di 100 m" });
      continue;
    }
    const line = compactLine(t.points);
    const res = ingestActivity(db, {
      owner,
      provider: "upload",
      external_id: uploadExternalId(t),
      sport: t.sport ?? opts.defaultSport,
      name: t.name.slice(0, 200),
      start_time: t.startTime ?? opts.now,
      line,
      ...stats,
      community_consent: opts.communityConsent,
      meta: { file: t.fileName, points: t.points.length },
      now: opts.now,
    });
    if (res.inserted) {
      out.imported++;
      out.ids.push(res.id);
    } else out.duplicates++;
  }
  return out;
}
