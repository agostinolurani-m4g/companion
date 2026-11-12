import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { UserRouteActivity } from "@/lib/sports";
import { OUTDOOR_GROUPS, type OutdoorGroup } from "@/lib/outdoor/groups";
import { outdoorFeaturesToGeoJson } from "@/lib/outdoor/geojson";
import { enqueueOutdoorTileFill } from "@/lib/outdoor/overpass-import";
import {
  countOutdoorByGroupInBbox,
  missingOutdoorTilesZ10,
  queryOutdoorFeaturesInBbox,
} from "@/lib/outdoor/store";
import { tilesZ10ForBbox } from "@/lib/outdoor/tiles";

export const runtime = "nodejs";

const VALID_SPORTS = new Set<string>([
  "road",
  "gravel",
  "mtb",
  "hike",
  "trail_run",
  "ski",
  "snowshoe",
  "nordic",
  "ferrata",
]);

export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const south = Number(url.searchParams.get("south"));
  const west = Number(url.searchParams.get("west"));
  const north = Number(url.searchParams.get("north"));
  const east = Number(url.searchParams.get("east"));
  const zoom = Number(url.searchParams.get("zoom") ?? "12");
  const sport = url.searchParams.get("sport");
  const groupsParam = url.searchParams.get("groups");
  const countsOnly = url.searchParams.get("counts") === "1";

  if (![south, west, north, east].every(Number.isFinite)) {
    return NextResponse.json({ error: "bbox richiesto" }, { status: 400 });
  }

  const db = getDb();
  const tiles = tilesZ10ForBbox(south, west, north, east);
  const allowFill = url.searchParams.get("fill") === "1";
  const missing = missingOutdoorTilesZ10(db, tiles);
  if (allowFill && missing.length > 0) {
    enqueueOutdoorTileFill(db, missing.slice(0, 2));
  }

  const groups =
    groupsParam
      ?.split(",")
      .map((g) => g.trim())
      .filter((g): g is OutdoorGroup => (OUTDOOR_GROUPS as readonly string[]).includes(g)) ?? null;

  const sportAct =
    sport && VALID_SPORTS.has(sport) ? (sport as UserRouteActivity) : null;

  const groupCounts = countOutdoorByGroupInBbox(db, south, west, north, east, zoom, sportAct);

  if (countsOnly) {
    return NextResponse.json({
      counts: groupCounts,
      tilesMissing: missing.length,
      tilesCovered: tiles.length - missing.length,
    });
  }

  const rows = queryOutdoorFeaturesInBbox(db, {
    south,
    west,
    north,
    east,
    zoom,
    sport: sportAct,
    groups,
    limit: 2500,
  });

  const geojson = outdoorFeaturesToGeoJson(rows);
  return NextResponse.json({
    geojson,
    counts: groupCounts,
    featureCount: rows.length,
    fillQueued: missing.length > 0,
  });
}
