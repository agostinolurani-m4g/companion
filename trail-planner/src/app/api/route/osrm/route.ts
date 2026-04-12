import { NextResponse } from "next/server";
import { getOpenRouteServiceApiKey } from "@/lib/env";
import {
  activityPrefersOrsFootHiking,
  fetchOrsFootHikingLine,
} from "@/lib/openrouteservice-route";
import type { OsrmProfile } from "@/lib/osrm-route";
import {
  activityToOsrmProfile,
  fetchOsrmRouteLine,
  normalizeActivityForRouting,
} from "@/lib/osrm-route";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      coordinates?: [number, number][];
      profile?: OsrmProfile;
      activity?: string;
    };
    const coordinates = body.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return NextResponse.json({ error: "Almeno 2 coordinate [lng,lat]" }, { status: 400 });
    }
    const activityNorm = normalizeActivityForRouting(body.activity ?? "hiking");
    const profile =
      body.profile ?? activityToOsrmProfile(activityNorm);

    const orsKey = getOpenRouteServiceApiKey();
    if (orsKey && profile === "foot" && activityPrefersOrsFootHiking(activityNorm)) {
      const ors = await fetchOrsFootHikingLine(coordinates, orsKey);
      if (ors) {
        return NextResponse.json({
          feature: ors.feature,
          profile: ors.meta.profileUsed,
          routingMode: ors.meta.mode,
          engine: "openrouteservice",
        });
      }
    }

    const result = await fetchOsrmRouteLine(coordinates, profile);
    if (!result) {
      return NextResponse.json(
        { error: "OSRM non ha restituito un percorso (prova altre tappe o più vicine)." },
        { status: 502 }
      );
    }
    return NextResponse.json({
      feature: result.feature,
      profile: result.meta.profileUsed,
      routingMode: result.meta.mode,
      engine: "osrm",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore routing" },
      { status: 500 }
    );
  }
}
