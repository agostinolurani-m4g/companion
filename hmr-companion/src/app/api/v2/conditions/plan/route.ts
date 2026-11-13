import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { normalizeOutingDate } from "@/lib/outings-types";
import { PLAN_MAX_POINTS, type PlanPointKind, type PlanPointRequest } from "@/lib/precision-weather";
import { fetchPlanForecast } from "@/lib/precision-weather-server";

export const runtime = "nodejs";

type Body = {
  start_date?: string | null;
  days?: number;
  points?: unknown;
};

const KINDS = new Set<PlanPointKind>(["start", "high", "camp", "end"]);

function parsePoints(raw: unknown): PlanPointRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanPointRequest[] = [];
  for (const it of raw.slice(0, PLAN_MAX_POINTS)) {
    if (!it || typeof it !== "object") continue;
    const p = it as Record<string, unknown>;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const ele = Number(p.ele);
    const day = Number(p.day);
    out.push({
      id: typeof p.id === "string" ? p.id.slice(0, 40) : String(out.length),
      label: typeof p.label === "string" ? p.label.slice(0, 120) : "",
      kind: KINDS.has(p.kind as PlanPointKind) ? (p.kind as PlanPointKind) : "start",
      day: Number.isInteger(day) && day >= 1 ? day : 1,
      lat,
      lng,
      ele: p.ele != null && Number.isFinite(ele) && ele > -500 && ele < 9000 ? ele : null,
    });
  }
  return out;
}

/**
 * Meteo di precisione per i punti di un itinerario (partenza, punti alti, pernotti):
 * ore alla quota del punto + confronto tra modelli ad alta risoluzione.
 */
export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const points = parsePoints(body.points);
  if (points.length === 0) return NextResponse.json({ error: "points richiesti" }, { status: 400 });

  try {
    const forecast = await fetchPlanForecast({
      startDate: normalizeOutingDate(body.start_date),
      days: Number(body.days) || 1,
      points,
    });
    return NextResponse.json({ forecast });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Errore previsioni" }, { status: 502 });
  }
}
