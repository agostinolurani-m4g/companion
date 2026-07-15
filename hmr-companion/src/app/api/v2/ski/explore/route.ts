import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  countOutingsVisibleForRoute,
  getGroupMember,
  listOutingsVisibleForRoute,
  listPublicSkiRoutes,
  listSkiRoutesForGroup,
  listSkiRoutesForMyOutings,
} from "@/lib/db";
import { parseExploreScope, routesToExploreGeoJson } from "@/lib/ski-explore";
import { routeEndpointsFromSkiGeojson } from "@/lib/ski-overlays";
import { serializeSkiOutings } from "@/lib/ski-outings";

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

  let routes;
  if (scope === "public") {
    routes = listPublicSkiRoutes();
  } else if (scope === "mine") {
    routes = listSkiRoutesForMyOutings(auth.email);
  } else {
    const groupId = scope.slice("group:".length);
    if (!getGroupMember(groupId, auth.email)) {
      return NextResponse.json({ error: "Non sei membro di questo gruppo" }, { status: 403 });
    }
    routes = listSkiRoutesForGroup(groupId);
  }

  const geojson = routesToExploreGeoJson(routes);
  const includeOutings = scope !== "public";
  return NextResponse.json({
    scope,
    count: routes.length,
    geojson,
    routes: routes.map((r) => {
      let geojson: GeoJSON.GeoJSON;
      try {
        geojson = JSON.parse(r.geojson) as GeoJSON.GeoJSON;
      } catch {
        geojson = { type: "FeatureCollection", features: [] };
      }
      const ep = routeEndpointsFromSkiGeojson(geojson);
      const outingCount = includeOutings
        ? countOutingsVisibleForRoute(r.id, auth.email)
        : 0;
      const outings =
        includeOutings && outingCount > 0
          ? serializeSkiOutings(listOutingsVisibleForRoute(r.id, auth.email))
          : [];
      return {
        id: r.id,
        name: r.name,
        owner: r.owner,
        length_km: r.length_km,
        elev_gain_m: r.elev_gain_m,
        elev_loss_m: r.elev_loss_m,
        source: r.source,
        source_url: r.source_url,
        license: r.license,
        start: ep?.start ?? null,
        end: ep?.end ?? null,
        outing_count: outingCount,
        latest_outing_date: outings[0]?.outing_date ?? null,
        outings,
      };
    }),
  });
}
