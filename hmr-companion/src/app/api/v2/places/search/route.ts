import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { geoCacheGet, geoCacheSet } from "@/lib/db";
import { geocodeNominatim, type PlaceSearchKind } from "@/lib/geocoding";

export const runtime = "nodejs";

const VALID_KINDS = new Set<PlaceSearchKind>(["all", "peak", "town", "water", "hut", "restaurant"]);

export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const kind = (url.searchParams.get("kind") ?? "all") as PlaceSearchKind;

  if (q.length < 2) {
    return NextResponse.json({ error: "Query troppo corta" }, { status: 400 });
  }
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: "kind non valido" }, { status: 400 });
  }

  const cacheKey = `v2place:${kind}:${q.toLowerCase()}`;
  const cached = geoCacheGet(cacheKey) as { results: Awaited<ReturnType<typeof geocodeNominatim>> } | null;
  if (cached?.results) {
    return NextResponse.json({ results: cached.results, fromCache: true });
  }

  try {
    const results = await geocodeNominatim(q, { kind, limit: 8 });
    geoCacheSet(cacheKey, { results });
    return NextResponse.json({ results, fromCache: false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ricerca luoghi fallita" },
      { status: 502 }
    );
  }
}
