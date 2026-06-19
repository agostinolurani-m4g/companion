import type { PoiCategory } from "./db";

const UA =
  process.env.NOMINATIM_USER_AGENT ??
  "HMRCompanion/1.0 (local-dev; contact: local-dev)";

export type PlaceSearchKind = "all" | "peak" | "town" | "water" | "hut" | "restaurant";

export type GeocodePoi = {
  id: string;
  name: string | null;
  category: PoiCategory;
  sub_kind: string;
  lat: number;
  lng: number;
};

export type GeocodeResult = {
  lat: number;
  lng: number;
  display_name: string;
  type: string | null;
  category: string | null;
};

type NominatimRow = {
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
};

function buildNominatimUrl(q: string, kind: PlaceSearchKind, limit: number): URL {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  const trimmed = q.trim();
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "0");

  switch (kind) {
    case "peak":
      url.searchParams.set("q", `${trimmed} peak`);
      break;
    case "town":
      url.searchParams.set("q", trimmed);
      url.searchParams.set("featuretype", "settlement");
      break;
    case "water":
      url.searchParams.set("q", `${trimmed} river lake`);
      break;
    case "hut":
      url.searchParams.set("q", `${trimmed} alpine hut refuge shelter`);
      break;
    case "restaurant":
      url.searchParams.set("q", `${trimmed} restaurant`);
      break;
    default:
      url.searchParams.set("q", trimmed);
  }
  return url;
}

export async function geocodeNominatim(
  q: string,
  opts?: { kind?: PlaceSearchKind; limit?: number }
): Promise<GeocodeResult[]> {
  const kind = opts?.kind ?? "all";
  const limit = opts?.limit ?? 8;
  if (!q.trim()) return [];

  const url = buildNominatimUrl(q, kind, limit);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json()) as NominatimRow[];
  return data.map((r) => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    display_name: r.display_name,
    type: r.type ?? null,
    category: r.class ?? null,
  }));
}

function inferPoiCategory(place: GeocodeResult, kind: PlaceSearchKind): PoiCategory {
  const cls = (place.category ?? "").toLowerCase();
  const typ = (place.type ?? "").toLowerCase();

  if (kind === "restaurant" || typ.includes("restaurant") || typ === "cafe" || typ === "fast_food") {
    return "restaurant";
  }
  if (kind === "water" || typ.includes("river") || typ.includes("lake") || typ === "water") {
    return "water";
  }
  if (
    kind === "hut" ||
    typ.includes("alpine_hut") ||
    typ === "shelter" ||
    typ === "wilderness_hut"
  ) {
    return "hut";
  }
  if (kind === "peak" || typ === "peak" || typ === "volcano") {
    return "hut";
  }
  if (
    kind === "town" ||
    cls === "place" ||
    typ === "city" ||
    typ === "town" ||
    typ === "village" ||
    typ === "hamlet"
  ) {
    return "lodging";
  }
  if (typ === "camp_site") return "campsite";
  if (typ === "pharmacy") return "pharmacy";
  return "shop";
}

export function geocodeToPoi(place: GeocodeResult, kind: PlaceSearchKind): GeocodePoi {
  const id = `geocode:${place.lat.toFixed(5)}:${place.lng.toFixed(5)}`;
  const name = place.display_name.split(",")[0]?.trim() || place.display_name;
  return {
    id,
    name,
    category: inferPoiCategory(place, kind),
    sub_kind: place.type ?? kind,
    lat: place.lat,
    lng: place.lng,
  };
}
