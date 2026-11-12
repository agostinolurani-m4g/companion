/** Bbox per gli script outdoor (formato "west,south,east,north", gradi WGS84). */

export type Bbox = { west: number; south: number; east: number; north: number };

/** Arco alpino coerente con l'area dei percorsi nel DB (5.8–10.8°E, 45.0–47.3°N). */
export const DEFAULT_OUTDOOR_BBOX: Bbox = { west: 5.8, south: 45.0, east: 10.8, north: 47.3 };

export function parseBboxEnv(raw: string | undefined, fallback: Bbox): Bbox {
  const v = raw?.trim();
  if (!v) return fallback;
  const parts = v.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    throw new Error(`Bbox non valida "${v}": usa west,south,east,north`);
  }
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west >= east || south >= north) throw new Error(`Bbox non valida "${v}": west<east e south<north`);
  return { west, south, east, north };
}

export function bboxContains(b: Bbox, lat: number, lng: number): boolean {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

export function splitBbox(b: Bbox, nx: number, ny: number): Bbox[] {
  const out: Bbox[] = [];
  const dx = (b.east - b.west) / nx;
  const dy = (b.north - b.south) / ny;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      out.push({
        west: b.west + i * dx,
        east: b.west + (i + 1) * dx,
        south: b.south + j * dy,
        north: b.south + (j + 1) * dy,
      });
    }
  }
  return out;
}
