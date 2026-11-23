/**
 * Altezza neve modellata (Open-Meteo, già usato per il meteo) su una griglia
 * che copre la mappa visibile. Funzioni pure qui; il fetch con cache SQLite è
 * in `snow-depth-server.ts`.
 *
 * È il valore del modello alla quota del DEM di ogni cella, non una misura:
 * utile per capire dove c'è neve, non per lo spessore esatto su un pendio.
 */

export type SnowCell = { key: string; lat: number; lng: number; size: number };

/** Passo della griglia (gradi) secondo lo zoom: ~2 km da vicino, ~10 km da lontano. */
export function gridStepForZoom(zoom: number): number {
  if (zoom >= 11) return 0.02;
  if (zoom >= 9.5) return 0.04;
  if (zoom >= 8) return 0.08;
  return 0.16;
}

/** Celle (centri allineati alla griglia) che coprono il bbox, al massimo `max`. */
export function snowCellsForBbox(
  bbox: { south: number; west: number; north: number; east: number },
  zoom: number,
  max = 400,
): SnowCell[] {
  let step = gridStepForZoom(zoom);
  // Se l'area è troppo grande per il passo, raddoppialo finché le celle stanno nel limite.
  for (;;) {
    const nx = Math.ceil((bbox.east - bbox.west) / step) + 1;
    const ny = Math.ceil((bbox.north - bbox.south) / step) + 1;
    if (nx * ny <= max || step >= 1.28) break;
    step *= 2;
  }
  const out: SnowCell[] = [];
  const x0 = Math.floor(bbox.west / step);
  const x1 = Math.ceil(bbox.east / step);
  const y0 = Math.floor(bbox.south / step);
  const y1 = Math.ceil(bbox.north / step);
  for (let y = y0; y < y1 && out.length < max; y++) {
    for (let x = x0; x < x1 && out.length < max; x++) {
      const lat = +((y + 0.5) * step).toFixed(5);
      const lng = +((x + 0.5) * step).toFixed(5);
      out.push({ key: `${step}:${x}:${y}`, lat, lng, size: step });
    }
  }
  return out;
}

/** Scala di colore: azzurro chiaro (poca) → blu → viola (tanta). null = niente neve. */
export const SNOW_SCALE = [
  { min: 1, color: "#e0f2fe", label: "1–10 cm" },
  { min: 10, color: "#93c5fd", label: "10–30 cm" },
  { min: 30, color: "#3b82f6", label: "30–60 cm" },
  { min: 60, color: "#1d4ed8", label: "60–120 cm" },
  { min: 120, color: "#6d28d9", label: "120–200 cm" },
  { min: 200, color: "#4c1d95", label: "> 2 m" },
] as const;

export function snowColor(cm: number | null): string | null {
  if (cm == null || cm < 1) return null;
  let c: string = SNOW_SCALE[0].color;
  for (const s of SNOW_SCALE) if (cm >= s.min) c = s.color;
  return c;
}

/** Valore all'ora corrente da una risposta oraria Open-Meteo (snow_depth in metri → cm). */
export function snowDepthNowCm(hourly: { time?: string[]; snow_depth?: (number | null)[] } | undefined, now: number): number | null {
  if (!hourly?.time?.length || !hourly.snow_depth) return null;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = Date.parse(`${hourly.time[i]}Z`);
    const d = Math.abs(t - now);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  const v = hourly.snow_depth[best];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null;
}

export function snowCellsToGeoJson(cells: (SnowCell & { cm: number | null })[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cells
      .filter((c) => c.cm != null && c.cm >= 1)
      .map((c) => {
        const h = c.size / 2;
        return {
          type: "Feature",
          properties: { cm: c.cm, color: snowColor(c.cm) },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [c.lng - h, c.lat - h],
                [c.lng + h, c.lat - h],
                [c.lng + h, c.lat + h],
                [c.lng - h, c.lat + h],
                [c.lng - h, c.lat - h],
              ],
            ],
          },
        };
      }),
  };
}
