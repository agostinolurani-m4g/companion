import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  getTrack,
  listTrackSurfaceSegments,
  replaceTrackSurfaceSegments,
} from "@/lib/db";
import { applySurfaceKmOverride } from "@/lib/surface-segment-merge";
import type { TrackSurfaceKind } from "@/lib/surface-osm";

export const runtime = "nodejs";

const KINDS: TrackSurfaceKind[] = ["asphalt", "gravel", "single", "unknown"];

type Ctx = { params: Promise<{ id: string }> };

function isSurface(s: unknown): s is TrackSurfaceKind {
  return typeof s === "string" && (KINDS as readonly string[]).includes(s);
}

/** GET: elenco segmenti superficie (per aggiornare il client). */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const t = getTrack(id);
  if (!t) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });
  return NextResponse.json({ segments: listTrackSurfaceSegments(id) });
}

/**
 * POST: sovrascrive un tratto [km_start, km_end] con la superficie scelta (merge su DB).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const t = getTrack(id);
  if (!t) return NextResponse.json({ error: "Track non trovato" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const kmStart = Number(o.km_start);
  const kmEnd = Number(o.km_end);
  const surface = o.surface;
  if (!Number.isFinite(kmStart) || !Number.isFinite(kmEnd)) {
    return NextResponse.json({ error: "km_start e km_end numerici richiesti" }, { status: 400 });
  }
  if (!isSurface(surface)) {
    return NextResponse.json({ error: "surface non valida" }, { status: 400 });
  }

  const L = t.length_km;
  const lo = Math.min(L, Math.max(0, Math.min(kmStart, kmEnd)));
  const hi = Math.min(L, Math.max(0, Math.max(kmStart, kmEnd)));
  if (hi <= lo + 1e-6) {
    return NextResponse.json({ error: "Intervallo km troppo corto" }, { status: 400 });
  }

  const existing = listTrackSurfaceSegments(id).map((r) => ({
    km_start: r.km_start,
    km_end: r.km_end,
    surface: r.surface,
    source: r.source || "osm_overpass",
  }));

  const merged = applySurfaceKmOverride(existing, lo, hi, surface);
  const rows = merged.map((m) => ({
    id: crypto.randomUUID(),
    km_start: m.km_start,
    km_end: m.km_end,
    surface: m.surface,
    source: m.source,
  }));

  replaceTrackSurfaceSegments(id, rows);
  return NextResponse.json({ ok: true, segments: listTrackSurfaceSegments(id) });
}
