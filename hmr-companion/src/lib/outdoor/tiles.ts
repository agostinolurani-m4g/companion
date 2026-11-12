/** Tile Web Mercator (EPSG:3857) per copertura z10. */

export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

export function tileBbox(z: number, x: number, y: number): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const north = (northRad * 180) / Math.PI;
  const south = (southRad * 180) / Math.PI;
  return { south, west, north, east };
}

export function tilesZ10ForBbox(
  south: number,
  west: number,
  north: number,
  east: number,
): Array<{ x: number; y: number }> {
  const z = 10;
  const tl = lngLatToTile(west, north, z);
  const br = lngLatToTile(east, south, z);
  const out: Array<{ x: number; y: number }> = [];
  for (let x = Math.min(tl.x, br.x); x <= Math.max(tl.x, br.x); x++) {
    for (let y = Math.min(tl.y, br.y); y <= Math.max(tl.y, br.y); y++) {
      out.push({ x, y });
    }
  }
  return out;
}
