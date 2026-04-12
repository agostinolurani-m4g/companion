import { NextResponse } from "next/server";
import { fetchOpenMeteoForecast } from "@/lib/weather";
import { getProfile } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !start || !end) {
    return NextResponse.json({ error: "Parametri: lat, lng, start, end (YYYY-MM-DD)" }, { status: 400 });
  }
  try {
    const forecast = await fetchOpenMeteoForecast(lat, lng, start, end);
    const prof = getProfile();
    const alerts: string[] = [];
    for (const d of forecast.daily) {
      if (d.precip_mm_max > prof.rain_mm_h) {
        alerts.push(`${d.date}: pioggia prevista elevata (${d.precip_mm_max.toFixed(1)} mm)`);
      }
      if (d.wind_speed_max_ms > prof.wind_ms) {
        alerts.push(`${d.date}: vento forte (max ~${d.wind_speed_max_ms.toFixed(0)} m/s)`);
      }
      if (d.temp_min_c < prof.frost_temp_c) {
        alerts.push(`${d.date}: temperature minime sotto soglia gelo (${d.temp_min_c.toFixed(0)}°C)`);
      }
    }
    return NextResponse.json({ forecast, alerts, thresholds: prof });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Meteo non disponibile" },
      { status: 500 }
    );
  }
}
