import { NextResponse } from "next/server";
import type { Feature, LineString } from "geojson";
import { geojsonLineToGpx } from "@/lib/gpx";
import { getItinerary } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { itineraryId?: string; name?: string; line?: Feature<LineString> };
    let feature: Feature<LineString>;
    let name = body.name ?? "itinerario";

    if (body.itineraryId) {
      const it = getItinerary(body.itineraryId);
      if (!it?.line_geojson) {
        return NextResponse.json({ error: "Itinerario senza traccia" }, { status: 400 });
      }
      name = it.name;
      feature = JSON.parse(it.line_geojson) as Feature<LineString>;
    } else if (body.line?.geometry?.type === "LineString") {
      feature = body.line;
    } else {
      return NextResponse.json({ error: "itineraryId o line" }, { status: 400 });
    }

    const xml = geojsonLineToGpx(name, feature);
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/gpx+xml",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}.gpx"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
