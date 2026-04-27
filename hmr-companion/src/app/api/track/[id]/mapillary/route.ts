import { NextResponse } from "next/server";
import { getTrack } from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import { collectMapillaryAlongTrack } from "@/lib/mapillary-along";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function num(q: string | null, fallback: number, min: number, max: number): number {
  const v = q != null && q !== "" ? Number(q) : NaN;
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const t = getTrack(id);
  if (!t) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });

  const token = process.env.MAPILLARY_ACCESS_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({
      configured: false,
      items: [] as unknown[],
      message:
        "Mapillary: opzionale — imposta MAPILLARY_ACCESS_TOKEN (vedi .env.example).",
    });
  }

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

  const maxDetourM = num(url.searchParams.get("max_detour_m"), 150, 30, 600);
  const maxItems = Math.floor(num(url.searchParams.get("max_items"), 28, 5, 80));

  const stored = JSON.parse(t.coords_json) as StoredCoord[];
  const bbox = JSON.parse(t.bbox_json) as {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };

  try {
    const items = await collectMapillaryAlongTrack({
      storedCoords: stored,
      bbox,
      kmWindow: { kmMin, kmMax },
      accessToken: token,
      maxDetourM,
      maxItems,
    });
    return NextResponse.json({
      configured: true,
      items,
      params: {
        max_detour_m: maxDetourM,
        max_items: maxItems,
        around_km: center,
        half_window_km: halfWindow,
        segment_km: { min: kmMin, max: kmMax },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore Mapillary";
    return NextResponse.json({ error: msg, configured: true, items: [] }, { status: 502 });
  }
}
