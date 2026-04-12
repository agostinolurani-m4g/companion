/** Query Overpass API (OpenStreetMap) — fontane e punti acqua potabile. */

export type WaterPoi = {
  lat: number;
  lng: number;
  name: string | null;
  kind: string;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Bbox (south, west, north, east) con padding in gradi (~1 km max). */
export function padBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  padDeg = 0.02
): { south: number; west: number; north: number; east: number } {
  return {
    south: clamp(south - padDeg, -85, 85),
    west: clamp(west - padDeg, -180, 180),
    north: clamp(north + padDeg, -85, 85),
    east: clamp(east + padDeg, -180, 180),
  };
}

export async function fetchDrinkingWaterInBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  limit = 40
): Promise<WaterPoi[]> {
  const q = `
[out:json][timeout:25];
(
  node["amenity"="drinking_water"](${south},${west},${north},${east});
  node["amenity"="fountain"](${south},${west},${north},${east});
  node["man_made"="water_tap"](${south},${west},${north},${east});
);
out body;
`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(q)}`,
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    elements?: Array<{
      type: string;
      lat?: number;
      lon?: number;
      tags?: Record<string, string>;
    }>;
  };
  const out: WaterPoi[] = [];
  for (const el of j.elements ?? []) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const tags = el.tags ?? {};
    const amenity = tags.amenity ?? tags.man_made ?? "water";
    out.push({
      lat: el.lat,
      lng: el.lon,
      name: tags.name ?? tags.ref ?? null,
      kind: amenity,
    });
  }
  return out.slice(0, limit);
}
