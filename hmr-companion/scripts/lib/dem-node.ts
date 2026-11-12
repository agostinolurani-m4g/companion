/**
 * Quote dai tile Terrarium (AWS) lato Node per gli script di import (decodifica con sharp).
 */
import sharp from "sharp";
import { decodeTerrarium, DEM_TILE_URL, lngLatToPixel } from "../../src/lib/dem-sample";

const TILE = 256;
const cache = new Map<string, Promise<Buffer | null>>();

async function tile(z: number, x: number, y: number): Promise<Buffer | null> {
  const key = `${z}/${x}/${y}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const url = DEM_TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) return null;
          const buf = Buffer.from(await res.arrayBuffer());
          return await sharp(buf).removeAlpha().raw().toBuffer();
        } catch {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      return null;
    })();
    cache.set(key, p);
    if (cache.size > 600) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

/** Quote (m) per punti [lng, lat]; null se il DEM non risponde. */
export async function elevationsNode(points: [number, number][], z = 12): Promise<number[] | null> {
  const out: number[] = [];
  for (const [lng, lat] of points) {
    const { px, py } = lngLatToPixel(lng, lat, z);
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    const data = await tile(z, tx, ty);
    if (!data) return null;
    const x = Math.min(TILE - 1, Math.max(0, Math.floor(px - tx * TILE)));
    const y = Math.min(TILE - 1, Math.max(0, Math.floor(py - ty * TILE)));
    const i = (y * TILE + x) * 3;
    out.push(decodeTerrarium(data[i]!, data[i + 1]!, data[i + 2]!));
  }
  return out;
}

/** Ricampiona una linea ogni `stepM` metri circa (per profilo e dislivello). */
export function resampleLine(line: [number, number][], stepM = 60, maxPts = 1500): [number, number][] {
  if (line.length < 2) return line;
  const out: [number, number][] = [line[0]!];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
    const dy = (b[1] - a[1]) * 110_540;
    acc += Math.hypot(dx, dy);
    if (acc >= stepM) {
      out.push(b);
      acc = 0;
    }
  }
  const last = line[line.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  if (out.length <= maxPts) return out;
  const step = (out.length - 1) / (maxPts - 1);
  return Array.from({ length: maxPts }, (_, k) => out[Math.round(k * step)]!);
}
