import type { Position } from "geojson";
import type { StreetViewAlongItem } from "@/lib/along-media-types";
import {
  geoCacheGet,
  geoCacheSet,
  geoStreetViewCacheKey,
} from "@/lib/db";
import { polylineBetween } from "@/lib/track-measure";
import type { StoredCoord } from "@/lib/track-coords";
import {
  cumulativeKmAlong,
  nearestPointOnPolyline,
  samplePointsAlongPolyline,
} from "@/lib/track-geometry";

export type { StreetViewAlongItem } from "@/lib/along-media-types";

/** Conteggi utili quando `items` è vuoto (montagna, soglia detour, errori API). */
export type StreetViewCollectionDiagnostics = {
  segment_points: number;
  samples_tried: number;
  /** Esempi: OK, ZERO_RESULTS, REQUEST_DENIED */
  metadata_status: Record<string, number>;
  metadata_fetch_errors: number;
  /** Panorama trovato ma oltre max_detour_m dalla polyline gara */
  panoramas_ok_but_over_max_detour_m: number;
  max_detour_m: number;
  /** Messaggio Google su primo REQUEST_DENIED, se presente */
  first_error_message?: string;
};

type SvMetadataResponse = {
  status: string;
  pano_id?: string;
  location?: { lat: number; lng: number };
  copyright?: string;
  error_message?: string;
};

function parseMetadata(json: unknown): SvMetadataResponse | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const status = typeof o.status === "string" ? o.status : "";
  if (!status) return null;
  return json as SvMetadataResponse;
}

async function fetchStreetViewMetadata(
  lat: number,
  lng: number,
  apiKey: string
): Promise<SvMetadataResponse> {
  const u = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
  u.searchParams.set("location", `${lat},${lng}`);
  u.searchParams.set("key", apiKey);
  const res = await fetch(u.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Street View metadata HTTP ${res.status}`);
  const j = (await res.json()) as unknown;
  const p = parseMetadata(j);
  if (!p) throw new Error("Street View: risposta non valida");
  return p;
}

function segmentLineForKmWindow(
  stored: StoredCoord[],
  kmMin: number,
  kmMax: number
): Position[] {
  const lo = Math.min(kmMin, kmMax);
  const hi = Math.max(kmMin, kmMax);
  const seg = polylineBetween(stored, lo, hi);
  if (seg.length === 0) return [];
  const pts: Position[] = seg.map(([lng, lat]) => [lng, lat]);
  if (pts.length === 1) return [pts[0], pts[0]];
  return pts;
}

export async function collectStreetViewAlongTrack(opts: {
  coords: Position[];
  cumKm?: number[];
  /** Traccia completa per proiezione pano → km e distanza. */
  storedCoords: StoredCoord[];
  /** Solo questo tratto viene campionato (meno chiamate API). */
  kmWindow: { kmMin: number; kmMax: number };
  apiKey: string;
  spacingKm: number;
  maxDetourM: number;
  maxPoints: number;
}): Promise<{ items: StreetViewAlongItem[]; diagnostics: StreetViewCollectionDiagnostics }> {
  const emptyDiag = (
    partial: Partial<StreetViewCollectionDiagnostics> & Pick<StreetViewCollectionDiagnostics, "segment_points">
  ): StreetViewCollectionDiagnostics => ({
    samples_tried: 0,
    metadata_status: {},
    metadata_fetch_errors: 0,
    panoramas_ok_but_over_max_detour_m: 0,
    max_detour_m: opts.maxDetourM,
    ...partial,
  });

  const { coords, apiKey, spacingKm, maxDetourM, maxPoints, storedCoords, kmWindow } = opts;
  if (coords.length < 2) {
    return {
      items: [],
      diagnostics: emptyDiag({ segment_points: 0 }),
    };
  }
  const cum = opts.cumKm ?? cumulativeKmAlong(coords);
  const sampleLine = segmentLineForKmWindow(storedCoords, kmWindow.kmMin, kmWindow.kmMax);
  if (sampleLine.length < 2) {
    return {
      items: [],
      diagnostics: emptyDiag({ segment_points: sampleLine.length }),
    };
  }
  const sampleCum = cumulativeKmAlong(sampleLine);
  const samples = samplePointsAlongPolyline(
    sampleLine,
    Math.max(0.15, spacingKm),
    Math.min(40, maxPoints + 6),
    sampleCum
  );
  const maxDetourKm = maxDetourM / 1000;
  const seen = new Set<string>();
  const out: StreetViewAlongItem[] = [];

  const diagnostics: StreetViewCollectionDiagnostics = {
    segment_points: sampleLine.length,
    samples_tried: samples.length,
    metadata_status: {},
    metadata_fetch_errors: 0,
    panoramas_ok_but_over_max_detour_m: 0,
    max_detour_m: maxDetourM,
  };

  let firstDeniedMsg: string | undefined;

  for (const s of samples) {
    const slat = s[1];
    const slng = s[0];
    const cacheKey = geoStreetViewCacheKey(slat, slng);
    let meta: SvMetadataResponse | null = null;
    const cached = geoCacheGet(cacheKey);
    if (cached != null) meta = parseMetadata(cached);
    if (meta == null) {
      try {
        meta = await fetchStreetViewMetadata(slat, slng, apiKey);
        geoCacheSet(cacheKey, meta);
      } catch {
        diagnostics.metadata_fetch_errors += 1;
        continue;
      }
    }
    const st = meta.status || "UNKNOWN";
    diagnostics.metadata_status[st] = (diagnostics.metadata_status[st] ?? 0) + 1;
    if (meta.status === "REQUEST_DENIED" && meta.error_message && !firstDeniedMsg) {
      firstDeniedMsg = meta.error_message;
    }
    if (meta.status !== "OK" || !meta.pano_id || !meta.location) continue;
    if (seen.has(meta.pano_id)) continue;
    const plat = meta.location.lat;
    const plng = meta.location.lng;
    const proj = nearestPointOnPolyline(coords, [plng, plat], cum);
    if (!proj || proj.distKm > maxDetourKm) {
      diagnostics.panoramas_ok_but_over_max_detour_m += 1;
      continue;
    }
    seen.add(meta.pano_id);
    out.push({
      pano_id: meta.pano_id,
      lat: plat,
      lng: plng,
      along_km: Number(proj.alongKm.toFixed(2)),
      detour_m: Math.round(proj.distKm * 1000),
      copyright: meta.copyright ?? null,
      sample_lat: slat,
      sample_lng: slng,
    });
    if (out.length >= maxPoints) break;
  }

  if (firstDeniedMsg) diagnostics.first_error_message = firstDeniedMsg;

  out.sort((a, b) => a.along_km - b.along_km);
  return { items: out, diagnostics };
}
