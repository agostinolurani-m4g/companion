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

type SvMetadataResponse = {
  status: string;
  pano_id?: string;
  location?: { lat: number; lng: number };
  copyright?: string;
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
}): Promise<StreetViewAlongItem[]> {
  const { coords, apiKey, spacingKm, maxDetourM, maxPoints, storedCoords, kmWindow } = opts;
  if (coords.length < 2) return [];
  const cum = opts.cumKm ?? cumulativeKmAlong(coords);
  const sampleLine = segmentLineForKmWindow(storedCoords, kmWindow.kmMin, kmWindow.kmMax);
  if (sampleLine.length < 2) return [];
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
        continue;
      }
    } else {
      /* use cached */
    }
    if (meta.status !== "OK" || !meta.pano_id || !meta.location) continue;
    if (seen.has(meta.pano_id)) continue;
    const plat = meta.location.lat;
    const plng = meta.location.lng;
    const proj = nearestPointOnPolyline(coords, [plng, plat], cum);
    if (!proj || proj.distKm > maxDetourKm) continue;
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

  out.sort((a, b) => a.along_km - b.along_km);
  return out;
}
