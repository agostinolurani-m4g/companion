import { NextResponse } from "next/server";
import type { UserRouteActivity } from "@/lib/db";
import { geoCacheGet, geoCacheSet, getDb } from "@/lib/db";
import { heatSportFamily, routePopularity, type RoutePopularity } from "@/lib/activities/heatmap";
import { fetchOrsAlternatives } from "@/lib/route-alternatives";
import { requireV2Beta } from "@/lib/auth";
import { getOpenRouteServiceApiKey } from "@/lib/env";
import {
  activityToOsrmProfile,
  fetchOsrmRouteLine,
  lineLengthKm,
} from "@/lib/osrm-route";
import {
  activityPrefersOrs,
  fetchOrsRouteLine,
  isRoutePreference,
  type OrsLeg,
  type OrsLegCache,
  type RoutePreference,
} from "@/lib/openrouteservice-route";
import type { RouteTech } from "@/lib/ors-route-tech";
import { USER_ROUTE_ACTIVITIES } from "@/lib/sports";

export const runtime = "nodejs";

const VALID_ACTIVITIES = new Set<UserRouteActivity>(USER_ROUTE_ACTIVITIES);

/** Tratti ORS in geo_cache: spostando una tappa si ricalcolano solo i tratti toccati. */
const ORS_LEG_CACHE: OrsLegCache = {
  get: (key) => {
    const v = geoCacheGet(key) as OrsLeg | null;
    return v && Array.isArray(v.coords) && v.coords.length >= 2 ? v : null;
  },
  set: (key, leg) => geoCacheSet(key, leg),
};

/** v3: profili per sport, preferenze, intervalli extra corretti. */
function routeCacheKey(
  coordinates: [number, number][],
  activity: UserRouteActivity,
  preference: RoutePreference,
  preferCycleways: boolean,
): string {
  const rounded = coordinates.map(([lng, lat]) => `${Math.round(lng * 1e5)}_${Math.round(lat * 1e5)}`).join(";");
  return `v2route:v7:${activity}:${preference}${preferCycleways ? ":cw3" : ""}:${rounded}`;
}

/** Popolarità (heatmap) calcolata a ogni richiesta: la heatmap cambia, la cache del routing no. */
function popularityFor(coords: GeoJSON.Position[], activity: UserRouteActivity, owner: string): RoutePopularity | null {
  try {
    return routePopularity(getDb(), coords, { owner, sports: heatSportFamily(activity) });
  } catch (e) {
    console.warn("[v2/route] popolarità non calcolata", e);
    return null;
  }
}

type RouteAlternative = { coordinates: [number, number][]; length_km: number; popularity: RoutePopularity | null };

async function alternativesFor(
  coordinates: [number, number][],
  activity: UserRouteActivity,
  preference: RoutePreference,
  owner: string,
): Promise<RouteAlternative[]> {
  const key = getOpenRouteServiceApiKey();
  if (!key || coordinates.length !== 2) return [];
  const alts = await fetchOrsAlternatives(coordinates, activity, key, preference);
  return alts
    .map((a) => ({ ...a, popularity: popularityFor(a.coordinates, activity, owner) }))
    .sort((a, b) => (b.popularity?.community_pct ?? 0) - (a.popularity?.community_pct ?? 0));
}

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  try {
    const body = (await req.json()) as {
      coordinates?: [number, number][];
      activity?: string;
      preference?: string;
      preferCycleways?: boolean;
      alternatives?: boolean;
    };
    const coordinates = body.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return NextResponse.json({ error: "Almeno 2 coordinate [lng,lat]" }, { status: 400 });
    }
    const activity = (body.activity ?? "hike") as UserRouteActivity;
    if (!VALID_ACTIVITIES.has(activity)) {
      return NextResponse.json({ error: "activity non valida" }, { status: 400 });
    }

    const preference: RoutePreference = isRoutePreference(body.preference) ? body.preference : "recommended";
    // Solo bici da strada: confronta strada e ciclabili asfaltate tratto per tratto.
    const preferCycleways = body.preferCycleways === true && activity === "road";
    const cacheKey = routeCacheKey(coordinates, activity, preference, preferCycleways);
    const cached = geoCacheGet(cacheKey) as {
      feature: GeoJSON.Feature<GeoJSON.LineString>;
      length_km: number;
      profile: string;
      engine: string;
      tech?: RouteTech | null;
    } | null;
    const wantAlternatives = body.alternatives === true;
    if (cached?.feature) {
      return NextResponse.json({
        ...cached,
        fromCache: true,
        popularity: popularityFor(cached.feature.geometry.coordinates, activity, auth.email),
        ...(wantAlternatives ? { alternatives: await alternativesFor(coordinates, activity, preference, auth.email) } : {}),
      });
    }

    const orsKey = getOpenRouteServiceApiKey();
    let feature: GeoJSON.Feature<GeoJSON.LineString> | null = null;
    let profile = activityToOsrmProfile(activity);
    let engine = "osrm";
    let tech: RouteTech | null = null;
    let snapped: [number, number][] | null = null;
    let spurs: { waypoint: number; km: number }[] = [];

    if (orsKey && activityPrefersOrs(activity)) {
      const ors = await fetchOrsRouteLine(coordinates, activity, orsKey, preference, ORS_LEG_CACHE, { preferCycleways });
      if (ors) {
        feature = ors.feature;
        profile = ors.meta.profileUsed as unknown as typeof profile;
        engine = "openrouteservice";
        tech = ors.tech;
        snapped = ors.snapped;
        spurs = ors.spurs;
      }
    } else if (!orsKey && activityPrefersOrs(activity)) {
      console.warn(
        `[v2/route] OPENROUTESERVICE_API_KEY mancante: attività "${activity}" instradata col fallback OSRM demo (solo profilo auto). Aggiungi la chiave in .env.local per il routing a piedi/MTB/gravel reale.`,
      );
    }

    if (!feature && orsKey && activityPrefersOrs(activity)) {
      // Niente ripiego su OSRM demo: serve solo strade per auto e produceva percorsi che
      // si arrotolano o si fermano a metà. Meglio dirlo.
      return NextResponse.json(
        { error: "Nessun sentiero raggiungibile vicino a una delle tappe: spostala più vicino a un sentiero o a una strada." },
        { status: 502 },
      );
    }

    if (!feature) {
      const osrm = await fetchOsrmRouteLine(coordinates, activityToOsrmProfile(activity));
      if (!osrm) {
        return NextResponse.json(
          { error: "Routing non riuscito (prova waypoint più vicini a strade/sentieri)." },
          { status: 502 }
        );
      }
      feature = osrm.feature;
      profile = osrm.meta.profileUsed;
      engine = "osrm";
      tech = null;
    }

    const coords = feature.geometry.coordinates as [number, number][];
    const length_km = lineLengthKm(coords);
    const payload = { feature, length_km, profile, engine, preference, routingMode: "snapped" as const, tech, snapped, spurs };
    geoCacheSet(cacheKey, payload);
    return NextResponse.json({
      ...payload,
      popularity: popularityFor(coords, activity, auth.email),
      ...(wantAlternatives ? { alternatives: await alternativesFor(coordinates, activity, preference, auth.email) } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore routing" },
      { status: 500 }
    );
  }
}
