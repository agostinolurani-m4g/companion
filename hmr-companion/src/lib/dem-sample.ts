/**
 * Quote da tile DEM Terrarium (AWS Terrain Tiles), lette nel browser.
 * Stessa sorgente usata per ombreggiatura/curve: nessuna API esterna extra, cache HTTP.
 */
export const DEM_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const DEM_ZOOM = 13;
const TILE = 256;

/** Decodifica Terrarium: (R·256 + G + B/256) − 32768 metri. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Coordinate pixel globali (Web Mercator) a zoom z. */
export function lngLatToPixel(lng: number, lat: number, z: number): { px: number; py: number } {
  const n = TILE * 2 ** z;
  const px = ((lng + 180) / 360) * n;
  const latRad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { px, py };
}

type TileData = Uint8ClampedArray | null;
const cache = new Map<string, Promise<TileData>>();

async function loadTile(z: number, x: number, y: number): Promise<TileData> {
  const key = `${z}/${x}/${y}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const url = DEM_TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
        const res = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(12_000) });
        if (!res.ok) return null;
        const bmp = await createImageBitmap(await res.blob());
        const canvas =
          typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(TILE, TILE)
            : Object.assign(document.createElement("canvas"), { width: TILE, height: TILE });
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!ctx) return null;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, TILE, TILE).data;
      } catch {
        return null;
      }
    })();
    cache.set(key, p);
    if (cache.size > 600) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

function pixelElev(data: Uint8ClampedArray, x: number, y: number): number {
  const i = (Math.max(0, Math.min(TILE - 1, y)) * TILE + Math.max(0, Math.min(TILE - 1, x))) * 4;
  return decodeTerrarium(data[i], data[i + 1], data[i + 2]);
}

/**
 * Quote (m) per una lista di [lng, lat], con interpolazione bilineare.
 * Restituisce null se il DEM non è raggiungibile o non siamo nel browser.
 */
export async function demElevations(points: Array<[number, number]>, z = DEM_ZOOM): Promise<number[] | null> {
  if (typeof window === "undefined" || typeof createImageBitmap === "undefined") return null;
  // Scarica in parallelo tutti i tile toccati (in serie un percorso lungo impiegava secondi).
  const needed = new Map<string, [number, number]>();
  for (const [lng, lat] of points) {
    const { px, py } = lngLatToPixel(lng, lat, z);
    const x0 = Math.floor(px - 0.5);
    const y0 = Math.floor(py - 0.5);
    for (const gx of [x0, x0 + 1]) {
      for (const gy of [y0, y0 + 1]) {
        const tx = Math.floor(gx / TILE);
        const ty = Math.floor(gy / TILE);
        needed.set(`${tx}/${ty}`, [tx, ty]);
      }
    }
  }
  await Promise.all([...needed.values()].map(([tx, ty]) => loadTile(z, tx, ty)));

  const out: number[] = [];
  for (const [lng, lat] of points) {
    const { px, py } = lngLatToPixel(lng, lat, z);
    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const samples: number[] = [];
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const gx = x0 + dx;
      const gy = y0 + dy;
      const data = await loadTile(z, Math.floor(gx / TILE), Math.floor(gy / TILE));
      if (!data) return null;
      samples.push(pixelElev(data, ((gx % TILE) + TILE) % TILE, ((gy % TILE) + TILE) % TILE));
    }
    const top = samples[0] * (1 - tx) + samples[1] * tx;
    const bottom = samples[2] * (1 - tx) + samples[3] * tx;
    out.push(top * (1 - ty) + bottom * ty);
  }
  return out;
}

/** Campionatore sincrono di quote su un'area già scaricata (null fuori area/tile mancante). */
export type DemSampler = (lng: number, lat: number) => number | null;

/**
 * Scarica i tile DEM che coprono il bbox a zoom `z` e restituisce un
 * campionatore sincrono (bilineare). Serve per calcoli con centinaia di
 * migliaia di campioni (panorama), dove l'await per punto sarebbe troppo lento.
 */
export async function demSamplerForBbox(
  bbox: { west: number; south: number; east: number; north: number },
  z: number,
): Promise<DemSampler | null> {
  if (typeof window === "undefined" || typeof createImageBitmap === "undefined") return null;
  const a = lngLatToPixel(bbox.west, bbox.north, z);
  const b = lngLatToPixel(bbox.east, bbox.south, z);
  const tx0 = Math.floor(a.px / TILE);
  const ty0 = Math.floor(a.py / TILE);
  const tx1 = Math.floor(b.px / TILE);
  const ty1 = Math.floor(b.py / TILE);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 100) return null;
  const tiles = new Map<string, Uint8ClampedArray>();
  await Promise.all(
    Array.from({ length: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) }, async (_, i) => {
      const tx = tx0 + (i % (tx1 - tx0 + 1));
      const ty = ty0 + Math.floor(i / (tx1 - tx0 + 1));
      const data = await loadTile(z, tx, ty);
      if (data) tiles.set(`${tx}/${ty}`, data);
    }),
  );
  if (!tiles.size) return null;
  const at = (gx: number, gy: number): number | null => {
    const d = tiles.get(`${Math.floor(gx / TILE)}/${Math.floor(gy / TILE)}`);
    return d ? pixelElev(d, ((gx % TILE) + TILE) % TILE, ((gy % TILE) + TILE) % TILE) : null;
  };
  return (lng, lat) => {
    const { px, py } = lngLatToPixel(lng, lat, z);
    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const s00 = at(x0, y0);
    const s10 = at(x0 + 1, y0);
    const s01 = at(x0, y0 + 1);
    const s11 = at(x0 + 1, y0 + 1);
    if (s00 == null || s10 == null || s01 == null || s11 == null) return null;
    return (s00 * (1 - tx) + s10 * tx) * (1 - ty) + (s01 * (1 - tx) + s11 * tx) * ty;
  };
}
