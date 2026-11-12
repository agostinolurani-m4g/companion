import type { Position } from "geojson";
import { demElevations } from "@/lib/dem-sample";

export type ElevationSample = {
  distanceKm: number[];
  elevationM: number[];
  sampled: Position[];
  /** false = quote non disponibili (profilo piatto di ripiego, non usare per D+/D−). */
  available: boolean;
};

/** Passo di campionamento lungo la linea: vicino alla risoluzione del DEM. */
export const ELEV_SAMPLE_SPACING_M = 25;
/** Tetto ai campioni: oltre, il passo si allarga (percorsi molto lunghi). */
export const ELEV_SAMPLE_MAX_POINTS = 6000;

/**
 * Ricampiona la linea a passo costante in metri (non per indice dei vertici: i vertici
 * sono radi sui rettilinei e fitti sui tornanti). `distanceKm` è la distanza vera lungo
 * la linea, quindi il totale coincide con la lunghezza del percorso.
 */
export function resampleLineByDistance(
  coordinates: Position[],
  spacingM = ELEV_SAMPLE_SPACING_M,
  maxPoints = ELEV_SAMPLE_MAX_POINTS,
): { sampled: Position[]; distanceKm: number[] } {
  if (coordinates.length < 2) return { sampled: [], distanceKm: [] };
  const cum: number[] = [0];
  for (let i = 1; i < coordinates.length; i++) {
    cum.push(cum[i - 1] + haversineKm(coordinates[i - 1], coordinates[i]));
  }
  const totalKm = cum[cum.length - 1];
  const stepKm = Math.max(spacingM / 1000, totalKm / Math.max(1, maxPoints - 1));
  const sampled: Position[] = [coordinates[0]];
  const distanceKm: number[] = [0];
  let seg = 1;
  for (let d = stepKm; d < totalKm - stepKm * 0.5; d += stepKm) {
    while (seg < cum.length - 1 && cum[seg] < d) seg++;
    const a = coordinates[seg - 1];
    const b = coordinates[seg];
    const len = cum[seg] - cum[seg - 1];
    const t = len > 1e-12 ? (d - cum[seg - 1]) / len : 0;
    sampled.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    distanceKm.push(d);
  }
  sampled.push(coordinates[coordinates.length - 1]);
  distanceKm.push(totalKm);
  return { sampled, distanceKm };
}

/**
 * Campiona una linea e ricava le quote: prima dai tile DEM Terrarium nel browser
 * (stessa sorgente del rilievo), poi Open-Elevation come ripiego.
 */
export async function sampleElevationsForLine(
  coordinates: Position[],
  maxPoints = ELEV_SAMPLE_MAX_POINTS
): Promise<ElevationSample> {
  if (coordinates.length < 2) {
    return { distanceKm: [], elevationM: [], sampled: [], available: false };
  }
  const { sampled, distanceKm } = resampleLineByDistance(
    coordinates,
    ELEV_SAMPLE_SPACING_M,
    Math.max(200, maxPoints),
  );

  const dem = await demElevations(sampled.map((c) => [c[0], c[1]] as [number, number]));
  if (dem && dem.every((v) => Number.isFinite(v))) {
    return { distanceKm, elevationM: dem.map((v) => Math.round(v * 10) / 10), sampled, available: true };
  }

  const locations = sampled.map((c) => ({ latitude: c[1], longitude: c[0] }));
  let elevationM: number[];
  try {
    const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ locations }),
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) return fallbackFlatProfile(sampled);
    const j = (await res.json()) as { results: { elevation: number }[] };
    elevationM = j.results.map((r) => r.elevation);
  } catch {
    return fallbackFlatProfile(sampled);
  }
  return { distanceKm, elevationM, sampled, available: true };
}

function haversineKm(a: Position, b: Position): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function fallbackFlatProfile(sampled: Position[]): ElevationSample {
  const elevationM = sampled.map(() => 500);
  const distanceKm: number[] = [0];
  for (let i = 1; i < sampled.length; i++) {
    distanceKm.push(distanceKm[i - 1] + haversineKm(sampled[i - 1], sampled[i]));
  }
  return { distanceKm, elevationM, sampled, available: false };
}
