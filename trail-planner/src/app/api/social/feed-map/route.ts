import { NextResponse } from "next/server";
import { DEMO_GROUP_CAI } from "@/lib/social-constants";
import { getActiveUserId, listOutingsForMapFeed } from "@/lib/db";
import { outingFeedToFeatureCollection } from "@/lib/social-geojson";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const viewer = getActiveUserId();
    if (!viewer) {
      return NextResponse.json(
        { error: "Imposta un utente attivo nel profilo (POC social)." },
        { status: 400 }
      );
    }
    const { searchParams } = new URL(req.url);
    const layer = searchParams.get("layer") ?? "friends";
    const groupId = searchParams.get("groupId") ?? undefined;
    const maxDays = Math.min(90, Math.max(1, parseInt(searchParams.get("maxDays") ?? "45", 10) || 45));

    if (layer !== "friends" && layer !== "group" && layer !== "following" && layer !== "public") {
      return NextResponse.json({ error: "layer non valido" }, { status: 400 });
    }

    const gid = layer === "group" ? (groupId ?? DEMO_GROUP_CAI) : null;

    const rows = listOutingsForMapFeed({
      viewerUserId: viewer,
      layer,
      groupId: gid,
      maxDays,
    });
    const featureCollection = outingFeedToFeatureCollection(rows);
    return NextResponse.json({
      viewer_user_id: viewer,
      layer,
      count: rows.length,
      geojson: featureCollection,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
