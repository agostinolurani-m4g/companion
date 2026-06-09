import type {
  GeoHazardCellRow,
  TrackDifficultySegmentRow,
  TrackRow,
} from "@/lib/db";
import {
  getTrack,
  listGeoHazardCellsInBbox,
  listTrackDifficultySegments,
  listTrackSurfaceSegments,
  replaceTrackDifficultySegments,
} from "@/lib/db";
import { computeSteepUnpavedSpans } from "@/lib/difficulty-steep";
import type { StoredCoord } from "@/lib/track-coords";
import { inferSportMode, type SportMode } from "@/lib/sport-modes";

export type DifficultySeverity = TrackDifficultySegmentRow["severity"];
export type DifficultySource = TrackDifficultySegmentRow["source"];

export type DifficultySegmentInput = {
  km_start: number;
  km_end: number;
  source: DifficultySource;
  severity: DifficultySeverity;
  label: string;
  metadata_json?: string | null;
};

function sacScaleToSeverity(sac: string): DifficultySeverity | null {
  const s = sac.toLowerCase();
  if (s.includes("demanding_alpine_hiking") || s === "t5") return "hard";
  if (s.includes("alpine_hiking") || s === "t4") return "hard";
  if (s.includes("mountain_hiking") || s === "t3") return "caution";
  if (s.includes("hiking") || s === "t2") return "info";
  if (s.includes("walking") || s === "t1") return "info";
  return null;
}

function mtbScaleToSeverity(scale: string): DifficultySeverity | null {
  const m = scale.match(/(\d)/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (n >= 3) return "hard";
  if (n >= 2) return "caution";
  return "info";
}

function mergeOverlapping(segments: DifficultySegmentInput[]): DifficultySegmentInput[] {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.km_start - b.km_start);
  const out: DifficultySegmentInput[] = [];
  let cur = { ...sorted[0]! };

  const rank: Record<DifficultySeverity, number> = {
    info: 0,
    caution: 1,
    hard: 2,
    extreme: 3,
  };

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (s.km_start <= cur.km_end + 0.02 && s.source === cur.source) {
      cur.km_end = Math.max(cur.km_end, s.km_end);
      if (rank[s.severity] > rank[cur.severity]) {
        cur.severity = s.severity;
        cur.label = s.label;
      }
    } else {
      out.push(cur);
      cur = { ...s };
    }
  }
  out.push(cur);
  return out;
}

function steepSegmentsForSport(
  coords: StoredCoord[],
  surfaceSpans: ReturnType<typeof listTrackSurfaceSegments>,
  sportMode: SportMode
): DifficultySegmentInput[] {
  const threshold =
    sportMode === "mtb" ? 12 : sportMode === "ski_mountaineering" ? 30 : 25;
  const spans = computeSteepUnpavedSpans(coords, surfaceSpans, threshold);
  return spans.map((s) => ({
    km_start: s.km_start,
    km_end: s.km_end,
    source: "auto_steep" as const,
    severity: s.grade_pct_max >= threshold + 10 ? "hard" : "caution",
    label:
      sportMode === "mtb"
        ? `HAB probabile (${s.grade_pct_max}%)`
        : `Pendenza ${s.grade_pct_max}%`,
    metadata_json: JSON.stringify({ grade_pct_max: s.grade_pct_max }),
  }));
}

function osmTagsToSegments(
  osmHits: Array<{ along_km: number; sac_scale?: string; mtb_scale?: string }>,
  sportMode: SportMode
): DifficultySegmentInput[] {
  const out: DifficultySegmentInput[] = [];
  for (const hit of osmHits) {
    const km = hit.along_km;
    if (sportMode === "trekking" && hit.sac_scale) {
      const sev = sacScaleToSeverity(hit.sac_scale);
      if (sev) {
        out.push({
          km_start: Math.max(0, km - 0.05),
          km_end: km + 0.05,
          source: "auto_osm",
          severity: sev,
          label: `SAC ${hit.sac_scale}`,
          metadata_json: JSON.stringify({ sac_scale: hit.sac_scale }),
        });
      }
    }
    if (sportMode === "mtb" && hit.mtb_scale) {
      const sev = mtbScaleToSeverity(hit.mtb_scale);
      if (sev) {
        out.push({
          km_start: Math.max(0, km - 0.05),
          km_end: km + 0.05,
          source: "auto_osm",
          severity: sev,
          label: `MTB ${hit.mtb_scale}`,
          metadata_json: JSON.stringify({ mtb_scale: hit.mtb_scale }),
        });
      }
    }
  }
  return out;
}

function hazardCellsToSegments(
  cells: GeoHazardCellRow[],
  coords: StoredCoord[]
): DifficultySegmentInput[] {
  const out: DifficultySegmentInput[] = [];
  if (coords.length < 2) return out;

  for (const cell of cells) {
    if (!cell.confirmed_at) continue;
    const parts = cell.cell_id.split(":");
    const kind = parts[parts.length - 1] ?? cell.report_kind;
    const severity: DifficultySeverity =
      kind === "avalanche" ? "extreme" : kind === "landslide" ? "hard" : "caution";
    const label =
      kind === "avalanche"
        ? `Valanga confermata (${cell.report_count})`
        : kind === "landslide"
          ? `Frana confermata (${cell.report_count})`
          : kind === "technical_trail"
            ? `Tecnico confermato (${cell.report_count})`
            : `Segnalazione confermata (${cell.report_count})`;

    const midKm = coords[Math.floor(coords.length / 2)]![3];
    out.push({
      km_start: Math.max(0, midKm - 0.1),
      km_end: midKm + 0.1,
      source: "geo_consensus",
      severity,
      label,
      metadata_json: JSON.stringify({ cell_id: cell.cell_id, kind }),
    });
  }
  return out;
}

export function estimateOverallGrade(
  segments: DifficultySegmentInput[],
  sportMode: SportMode
): string {
  const rank: Record<DifficultySeverity, number> = {
    info: 0,
    caution: 1,
    hard: 2,
    extreme: 3,
  };
  let max = 0;
  for (const s of segments) {
    max = Math.max(max, rank[s.severity]);
  }
  if (sportMode === "trekking") {
    if (max >= 3) return "EEA";
    if (max >= 2) return "EE";
    if (max >= 1) return "E";
    return "T";
  }
  if (sportMode === "mtb") {
    if (max >= 3) return "S3+";
    if (max >= 2) return "S2";
    if (max >= 1) return "S1";
    return "S0";
  }
  if (max >= 3) return "Rischio alto";
  if (max >= 2) return "Impegnativo";
  if (max >= 1) return "Moderato";
  return "Facile";
}

export type AnalyzeOptions = {
  osmHits?: Array<{ along_km: number; sac_scale?: string; mtb_scale?: string }>;
};

export function buildDifficultySegments(
  track: TrackRow,
  opts?: AnalyzeOptions
): DifficultySegmentInput[] {
  const coords = JSON.parse(track.coords_json) as StoredCoord[];
  const bbox = JSON.parse(track.bbox_json) as {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  const sportMode = (track.sport_mode as SportMode | null) ?? inferSportMode(track.activity_type);
  const surfaceSpans = listTrackSurfaceSegments(track.id);

  const parts: DifficultySegmentInput[] = [
    ...steepSegmentsForSport(coords, surfaceSpans, sportMode),
    ...osmTagsToSegments(opts?.osmHits ?? [], sportMode),
    ...hazardCellsToSegments(
      listGeoHazardCellsInBbox(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng),
      coords
    ),
  ];

  return mergeOverlapping(parts);
}

export function analyzeTrackDifficulty(trackId: string, opts?: AnalyzeOptions): {
  segments: TrackDifficultySegmentRow[];
  grade: string;
} {
  const track = getTrack(trackId);
  if (!track) throw new Error("Traccia non trovata");

  const built = buildDifficultySegments(track, opts);
  replaceTrackDifficultySegments(trackId, built);

  const segments = listTrackDifficultySegments(trackId);
  const sportMode = (track.sport_mode as SportMode | null) ?? inferSportMode(track.activity_type);
  const grade = estimateOverallGrade(built, sportMode);
  return { segments, grade };
}

export function difficultyToNotableSections(
  segments: TrackDifficultySegmentRow[]
): Array<{
  id: string;
  label: string;
  km_start: number;
  km_end: number;
  severity: string;
  description: string;
}> {
  return segments.map((s) => ({
    id: s.id,
    label: s.label,
    km_start: s.km_start,
    km_end: s.km_end,
    severity:
      s.severity === "extreme" || s.severity === "hard"
        ? "hard"
        : s.severity === "caution"
          ? "warn"
          : "info",
    description: s.label,
  }));
}
