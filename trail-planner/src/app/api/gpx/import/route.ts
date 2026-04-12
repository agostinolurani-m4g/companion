import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { insertTrack, updateItineraryLine } from "@/lib/db";
import { ingestGpxXml } from "@/lib/track-ingest";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { xml?: string; itinerary_id?: string | null };
    if (!body.xml?.trim()) {
      return NextResponse.json({ error: "xml richiesto" }, { status: 400 });
    }

    const trackId = uuidv4();
    const result = ingestGpxXml(body.xml, trackId);
    const s = result.summary;
    const bbox_json = JSON.stringify(s.bbox);

    insertTrack({
      id: trackId,
      itinerary_id: body.itinerary_id?.trim() || null,
      point_count: s.point_count,
      distance_m: s.distance_m,
      elev_gain_m: s.elevation_gain_m,
      elev_loss_m: s.elevation_loss_m,
      bbox_json,
      duration_sec: s.duration_sec,
      display_point_count: s.display_point_count,
      display_line_geojson: JSON.stringify(result.displayFeature),
      has_elevation: s.has_elevation,
      encoded_preview: s.encoded_preview,
    });

    let itinerary_line_updated = false;
    if (body.itinerary_id?.trim()) {
      updateItineraryLine(body.itinerary_id.trim(), JSON.stringify(result.displayFeature));
      itinerary_line_updated = true;
    }

    return NextResponse.json({
      track_id: trackId,
      summary: {
        point_count: s.point_count,
        distance_m: s.distance_m,
        elevation_gain_m: s.elevation_gain_m,
        elevation_loss_m: s.elevation_loss_m,
        bbox: s.bbox,
        has_elevation: s.has_elevation,
        duration_sec: s.duration_sec,
        display_point_count: s.display_point_count,
        encoded_preview: s.encoded_preview,
      },
      displayFeature: result.displayFeature,
      itinerary_line_updated,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore import GPX" },
      { status: 500 }
    );
  }
}
