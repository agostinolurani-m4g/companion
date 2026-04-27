import type { Position } from "geojson";

/** Sample coordinates along a line and fetch elevation from Open-Elevation (POST). */
export async function sampleElevationsForLine(
  coordinates: Position[],
  maxPoints = 80
): Promise<{ distanceKm: number[]; elevationM: number[] }> {
  if (coordinates.length < 2) {
    return { distanceKm: [], elevationM: [] };
  }
  const sampled: Position[] = [];
  const total = coordinates.length;
  const step = Math.max(1, Math.floor((total - 1) / (maxPoints - 1)));
  for (let i = 0; i < total; i += step) sampled.push(coordinates[i]);
  if (sampled[sampled.length - 1] !== coordinates[total - 1]) {
    sampled.push(coordinates[total - 1]);
  }

  const locations = sampled.map((c) => ({ latitude: c[1], longitude: c[0] }));
  let elevationM: number[];
  try {
    const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ locations }),
      signal: AbortSignal.timeout(14_000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return fallbackFlatProfile(sampled);
    }
    const j = (await res.json()) as { results: { elevation: number }[] };
    elevationM = j.results.map((r) => r.elevation);
  } catch {
    return fallbackFlatProfile(sampled);
  }
  const distanceKm: number[] = [0];
  for (let i = 1; i < sampled.length; i++) {
    const d = haversineKm(sampled[i - 1], sampled[i]);
    distanceKm.push(distanceKm[i - 1] + d);
  }
  return { distanceKm, elevationM };
}

function haversineKm(a: Position, b: Position): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Dislivello positivo/negativo approssimato dal profilo campionato (Open-Elevation). */
export function elevationGainLossM(elevationM: number[]): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevationM.length; i++) {
    const d = elevationM[i] - elevationM[i - 1];
    if (d >= 0) gain += d;
    else loss += -d;
  }
  return { gain, loss };
}

function fallbackFlatProfile(sampled: Position[]): { distanceKm: number[]; elevationM: number[] } {
  const elevationM = sampled.map(() => 500);
  const distanceKm: number[] = [0];
  for (let i = 1; i < sampled.length; i++) {
    distanceKm.push(distanceKm[i - 1] + haversineKm(sampled[i - 1], sampled[i]));
  }
  return { distanceKm, elevationM };
}
