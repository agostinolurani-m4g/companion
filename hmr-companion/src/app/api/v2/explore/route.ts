import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  countOutingsVisibleForRoute,
  getGroupMember,
  listOutingsVisibleForRoute,
  listPublicRoutesInBbox,
  listRoutesForExplore,
  type UserRouteActivity,
} from "@/lib/db";
import { parseActivityFilter, parseExploreScope, routeEndpoints, routesToExploreGeoJson } from "@/lib/explore";
import { serializeOutings } from "@/lib/outings";
import { computeRouteFacts, routeFactsBrief } from "@/lib/route-facts";
import { isAffinityMatch } from "@/lib/sport-affinity";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const scopeRaw = url.searchParams.get("scope") ?? "public";
  const scope = parseExploreScope(scopeRaw);
  if (!scope) {
    return NextResponse.json({ error: "Scope non valido (public | mine | group:<id>)" }, { status: 400 });
  }

  const activity = parseActivityFilter(url.searchParams.get("activity"));

  const bboxRaw = url.searchParams.get("bbox");
  const bboxParts = bboxRaw?.split(",").map(Number);
  const bbox =
    bboxParts && bboxParts.length === 4 && bboxParts.every(Number.isFinite)
      ? { south: bboxParts[0]!, west: bboxParts[1]!, north: bboxParts[2]!, east: bboxParts[3]! }
      : null;
  const zoom = Number(url.searchParams.get("zoom") ?? "12");

  let routes;
  let total: number | null = null;
  if (scope === "public" && bbox) {
    const res = listPublicRoutesInBbox(activity, bbox, 400);
    routes = res.rows;
    total = res.total;
  } else if (scope === "public") {
    routes = listRoutesForExplore(activity, "public", auth.email);
  } else if (scope === "mine") {
    routes = listRoutesForExplore(activity, "mine", auth.email);
  } else {
    const groupId = scope.slice("group:".length);
    if (!getGroupMember(groupId, auth.email)) {
      return NextResponse.json({ error: "Non sei membro di questo gruppo" }, { status: 403 });
    }
    routes = listRoutesForExplore(activity, "group", auth.email, groupId);
  }

  // Geometrie alleggerite: a zoom basso bastano pochi vertici per tracciato.
  const maxPts = zoom >= 14 ? 800 : zoom >= 12 ? 300 : zoom >= 10 ? 120 : 60;
  const geojson = routesToExploreGeoJson(routes, maxPts);
  const includeOutings = scope !== "public";
  return NextResponse.json({
    scope,
    activity: activity ?? "all",
    count: routes.length,
    total: total ?? routes.length,
    geojson,
    routes: routes.map((r) => {
      let parsed: GeoJSON.GeoJSON;
      try {
        parsed = JSON.parse(r.geojson) as GeoJSON.GeoJSON;
      } catch {
        parsed = { type: "FeatureCollection", features: [] };
      }
      const ep = routeEndpoints(parsed);
      const outingCount = includeOutings
        ? countOutingsVisibleForRoute(r.id, auth.email)
        : 0;
      const outings =
        includeOutings && outingCount > 0
          ? serializeOutings(listOutingsVisibleForRoute(r.id, auth.email))
          : [];
      return {
        id: r.id,
        name: r.name,
        owner: r.owner,
        activity: r.activity,
        length_km: r.length_km,
        elev_gain_m: r.elev_gain_m,
        elev_loss_m: r.elev_loss_m,
        source: r.source,
        source_url: r.source_url,
        license: r.license,
        ...routeFactsBrief(computeRouteFacts(r)),
        affinity: isAffinityMatch(activity, r.activity),
        start: ep.start,
        end: ep.end,
        outing_count: outingCount,
        latest_outing_date: outings[0]?.outing_date ?? null,
        outings,
      };
    }),
  });
}
