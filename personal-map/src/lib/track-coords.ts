import type { Position } from "geojson";

export type StoredCoord = [number, number, number | null, number];

/** Converte l'array compatto salvato nel DB in Position[] (lng,lat[,elev]). */
export function coordsFromStored(stored: StoredCoord[]): Position[] {
  return stored.map((c) => {
    const p: Position = [c[0], c[1]];
    if (c[2] != null) p.push(c[2]);
    return p;
  });
}

export function cumFromStored(stored: StoredCoord[]): number[] {
  return stored.map((c) => c[3]);
}

export function elevFromStored(stored: StoredCoord[]): Array<number | null> {
  return stored.map((c) => c[2]);
}
