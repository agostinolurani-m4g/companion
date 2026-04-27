import { NextResponse } from "next/server";
import {
  getTrack,
  listTrackStreetViewPointsInKmRange,
  upsertTrackStreetViewPoints,
} from "@/lib/db";
import { googleMapsStreetViewLayerUrl } from "@/lib/gmaps-url";
import { coordsFromStored, cumFromStored, type StoredCoord } from "@/lib/track-coords";
import { collectStreetViewAlongTrack } from "@/lib/street-view-along";
import type { StreetViewAlongItem } from "@/lib/along-media-types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function num(q: string | null, fallback: number, min: number, max: number): number {
  const v = q != null && q !== "" ? Number(q) : NaN;
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function withMapsUrls(items: StreetViewAlongItem[]): StreetViewAlongItem[] {
  return items.map((it) => ({
    ...it,
    maps_url: it.maps_url ?? googleMapsStreetViewLayerUrl(it.lat, it.lng),
  }));
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const t = getTrack(id);
  if (!t) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });

  const url = new URL(req.url);
  const lengthKm = t.length_km;
  const aroundRaw = url.searchParams.get("around_km");
  const center =
    aroundRaw != null && aroundRaw !== "" && Number.isFinite(Number(aroundRaw))
      ? num(aroundRaw, lengthKm / 2, 0, lengthKm)
      : lengthKm / 2;
  const halfWindow = num(url.searchParams.get("half_window_km"), 6, 1, 40);
  const kmMin = Math.max(0, center - halfWindow);
  const kmMax = Math.min(lengthKm, center + halfWindow);
  const refresh = url.searchParams.get("refresh") === "1";
  const prefetchOnly = url.searchParams.get("prefetch_only") === "1";

  const spacingKm = num(url.searchParams.get("spacing_km"), 1.5, 0.25, 25);
  const maxDetourM = num(url.searchParams.get("max_detour_m"), 100, 20, 500);
  const maxPoints = Math.floor(num(url.searchParams.get("max_points"), 12, 2, 24));

  const params = {
    spacing_km: spacingKm,
    max_detour_m: maxDetourM,
    max_points: maxPoints,
    around_km: center,
    half_window_km: halfWindow,
    segment_km: { min: kmMin, max: kmMax },
  };

  const cached = listTrackStreetViewPointsInKmRange(id, kmMin, kmMax);
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();

  if (prefetchOnly) {
    return NextResponse.json({
      configured: Boolean(key),
      items: cached,
      source: cached.length > 0 ? ("db" as const) : ("none" as const),
      params,
    });
  }

  if (!refresh && cached.length > 0) {
    return NextResponse.json({
      configured: Boolean(key),
      items: cached,
      source: "db" as const,
      params,
    });
  }

  if (!key) {
    if (cached.length > 0) {
      return NextResponse.json({
        configured: false,
        items: cached,
        source: "db" as const,
        message:
          "Punti salvati in locale. Per aggiornare da Google serve GOOGLE_MAPS_API_KEY.",
        params,
      });
    }
    return NextResponse.json({
      configured: false,
      items: [] as StreetViewAlongItem[],
      message:
        "Street View: imposta GOOGLE_MAPS_API_KEY nel server (vedi .env.example).",
      params,
    });
  }

  const stored = JSON.parse(t.coords_json) as StoredCoord[];
  const coords = coordsFromStored(stored);
  const cumKm = cumFromStored(stored);

  try {
    const collected = await collectStreetViewAlongTrack({
      coords,
      cumKm,
      storedCoords: stored,
      kmWindow: { kmMin, kmMax },
      apiKey: key,
      spacingKm,
      maxDetourM,
      maxPoints,
    });
    const enriched = withMapsUrls(collected);
    upsertTrackStreetViewPoints(id, enriched);
    const items = listTrackStreetViewPointsInKmRange(id, kmMin, kmMax);
    return NextResponse.json({
      configured: true,
      items,
      source: "live" as const,
      params,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore Street View";
    if (cached.length > 0) {
      return NextResponse.json({
        configured: true,
        items: cached,
        source: "db" as const,
        warning: msg,
        params,
      });
    }
    return NextResponse.json({ error: msg, configured: true, items: [] }, { status: 502 });
  }
}
