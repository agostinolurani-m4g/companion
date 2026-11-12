import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { avalancheForPoint, buildAvalancheMap } from "@/lib/avalanche-bulletin";

export const runtime = "nodejs";

function numParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET senza parametri: FeatureCollection delle micro-regioni EAWS con grado di pericolo.
 * GET `?lat=&lng=[&orientations=N,NW][&min_ele=&max_ele=]`: dettaglio del bollettino nel punto
 * (problemi valanghivi, quote, esposizioni, tendenza, testo) e confronto con le esposizioni.
 */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const lat = numParam(url, "lat");
  const lng = numParam(url, "lng");

  try {
    if (lat != null && lng != null) {
      const orientations = (url.searchParams.get("orientations") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const point = await avalancheForPoint(lat, lng, {
        orientations,
        minEle: numParam(url, "min_ele"),
        maxEle: numParam(url, "max_ele"),
      });
      return NextResponse.json({ point }, { headers: { "Cache-Control": "private, max-age=300" } });
    }
    const payload = await buildAvalancheMap();
    return NextResponse.json(payload, {
      // La scadenza reale è gestita dalla cache server legata a validUntil (max 3 h).
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore bollettino" },
      { status: 500 },
    );
  }
}
