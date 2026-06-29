import { NextResponse } from "next/server";
import type { UserRouteActivity } from "@/lib/db";
import { geoCacheGet, geoCacheSet } from "@/lib/db";
import { requireV2Beta } from "@/lib/auth";
import { getOpenRouteServiceApiKey } from "@/lib/env";
import {
  activityToOsrmProfile,
  fetchOsrmRouteLine,
  lineLengthKm,
} from "@/lib/osrm-route";
import { activityPrefersOrs, fetchOrsRouteLine } from "@/lib/openrouteservice-route";
import type { RouteTech } from "@/lib/ors-route-tech";

export const runtime = "nodejs";

const VALID_ACTIVITIES = new Set<UserRouteActivity>(["road", "mtb", "hike", "gravel"]);

function routeCacheKey(coordinates: [number, number][], activity: UserRouteActivity): string {
  const rounded = coordinates.map(([lng, lat]) => `${Math.round(lng * 1e5)}_${Math.round(lat * 1e5)}`).join(";");
  return `v2route:${activity}:${rounded}`;
}

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  try {
    const body = (await req.json()) as {
      coordinates?: [number, number][];
      activity?: string;
    };
    const coordinates = body.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return NextResponse.json({ error: "Almeno 2 coordinate [lng,lat]" }, { status: 400 });
    }
    const activity = (body.activity ?? "hike") as UserRouteActivity;
    if (!VALID_ACTIVITIES.has(activity)) {
      return NextResponse.json({ error: "activity non valida" }, { status: 400 });
    }

    const cacheKey = routeCacheKey(coordinates, activity);
    const cached = geoCacheGet(cacheKey) as {
      feature: GeoJSON.Feature<GeoJSON.LineString>;
      length_km: number;
      profile: string;
      engine: string;
      tech?: RouteTech | null;
    } | null;
    if (cached?.feature) {
      return NextResponse.json({ ...cached, fromCache: true });
    }

    const orsKey = getOpenRouteServiceApiKey();
    let feature: GeoJSON.Feature<GeoJSON.LineString> | null = null;
    let profile = activityToOsrmProfile(activity);
    let engine = "osrm";
    let tech: RouteTech | null = null;

    if (orsKey && activityPrefersOrs(activity)) {
      const ors = await fetchOrsRouteLine(coordinates, activity, orsKey);
      if (ors) {
        feature = ors.feature;
        profile = ors.meta.profileUsed as unknown as typeof profile;
        engine = "openrouteservice";
        tech = ors.tech;
      }
    } else if (!orsKey && activityPrefersOrs(activity)) {
      console.warn(
        `[v2/route] OPENROUTESERVICE_API_KEY mancante: attività "${activity}" instradata col fallback OSRM demo (solo profilo auto). Aggiungi la chiave in .env.local per il routing a piedi/MTB/gravel reale.`,
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
    const payload = { feature, length_km, profile, engine, routingMode: "snapped" as const, tech };
    geoCacheSet(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore routing" },
      { status: 500 }
    );
  }
}
