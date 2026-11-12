/** Stazioni meteo open (MeteoSwiss OGD — elenco semplificato). */

export type WeatherStationReading = {
  stationId: string;
  name: string;
  lat: number;
  lng: number;
  temperatureC?: number;
  windKmh?: number;
  snowCm?: number;
  fetchedAt: number;
};

const CACHE_TTL_SEC = 3600;

let cache: { bbox: string; at: number; items: WeatherStationReading[] } | null = null;

export async function weatherNearPoint(lat: number, lng: number): Promise<WeatherStationReading[]> {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.bbox === key && now - cache.at < CACHE_TTL_SEC) return cache.items;

  // MeteoSwiss metadata CSV (stations) — campione leggero via API pubblica meteoswiss
  const url =
    "https://opendata.swiss/api/records/1.0/search/?dataset=automatic-weather-stations&rows=5&q=&geofilter.distance=" +
    `${lat},${lng}&sort=distance`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      records?: Array<{
        fields?: { station_name?: string; station_id?: string; coordinates?: [number, number] };
      }>;
    };
    const items: WeatherStationReading[] = (data.records ?? []).map((r) => {
      const f = r.fields ?? {};
      const coords = f.coordinates ?? [lng, lat];
      return {
        stationId: String(f.station_id ?? "ch"),
        name: String(f.station_name ?? "Stazione"),
        lat: coords[1],
        lng: coords[0],
        fetchedAt: now,
      };
    });
    cache = { bbox: key, at: now, items };
    return items;
  } catch {
    return [];
  }
}
