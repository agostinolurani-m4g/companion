import type { Position } from "geojson";
import { demElevations } from "@/lib/dem-sample";

export type ElevationSample = {
  distanceKm: number[];
  elevationM: number[];
  sampled: Position[];
  /** false = quote non disponibili (profilo piatto di ripiego, non usare per D+/D−). */
  available: boolean;
};

/**
 * Campiona una linea e ricava le quote: prima dai tile DEM Terrarium nel browser
 * (stessa sorgente del rilievo), poi Open-Elevation come ripiego.
 */
export async function sampleElevationsForLine(
  coordinates: Position[],
  maxPoints = 160
): Promise<ElevationSample> {
  if (coordinates.length < 2) {
    return { distanceKm: [], elevationM: [], sampled: [], available: false };
  }
  const sampled: Position[] = [];
  const total = coordinates.length;
  const step = Math.max(1, Math.floor((total - 1) / (maxPoints - 1)));
  for (let i = 0; i < total; i += step) sampled.push(coordinates[i]);
  if (sampled[sampled.length - 1] !== coordinates[total - 1]) {
    sampled.push(coordinates[total - 1]);
  }

  const distanceKm: number[] = [0];
  for (let i = 1; i < sampled.length; i++) {
    distanceKm.push(distanceKm[i - 1] + haversineKm(sampled[i - 1], sampled[i]));
  }

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
