import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { COMMUNITY_SCOPE, personalScope, queryHeat } from "@/lib/activities/heatmap";
import { isUserRouteActivity } from "@/lib/sports";

export const runtime = "nodejs";

/**
 * Heatmap come punti pesati per il layer MapLibre `heatmap`.
 * `?scope=me|community&bbox=w,s,e,n&z=12&sport=mtb,gravel`
 * `me` include anche Strava (visibile solo al proprietario), `community` mai.
 */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope") ?? "community";
  const scope = scopeParam === "me" ? personalScope(auth.email) : COMMUNITY_SCOPE;
  const bbox = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "bbox richiesto (w,s,e,n)" }, { status: 400 });
  }
  const z = Number(url.searchParams.get("z") ?? 12);
  const sports = (url.searchParams.get("sport") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && isUserRouteActivity(s));
  const result = queryHeat(getDb(), {
    scope,
    bbox: bbox as [number, number, number, number],
    zoom: Number.isFinite(z) ? z : 12,
    sports: sports.length ? sports : undefined,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
}
