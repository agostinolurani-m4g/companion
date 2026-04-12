"use client";

import { useMemo } from "react";
import { buildWindyMainSiteUrl } from "@/lib/windy-embed";
import { usePlanner } from "@/context/PlannerProvider";

export function WeatherTabPanel() {
  const {
    weatherForecast,
    weatherAlerts,
    refreshWeather,
    setWindyOverlay,
    stops,
    itinerary,
  } = usePlanner();

  const windyMainHref = useMemo(() => {
    if (stops.length === 0) return "https://www.windy.com/";
    const sorted = [...stops].sort((a, b) => a.order_index - b.order_index);
    const mid = sorted[Math.floor(sorted.length / 2)];
    return buildWindyMainSiteUrl(mid.lat, mid.lng, 8);
  }, [stops]);

  const openWindy = () => {
    if (stops.length === 0) return;
    const sorted = [...stops].sort((a, b) => a.order_index - b.order_index);
    const mid = sorted[Math.floor(sorted.length / 2)];
    setWindyOverlay({ lat: mid.lat, lng: mid.lng, zoom: 8 });
  };

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
          onClick={() => void refreshWeather()}
        >
          Aggiorna previsioni
        </button>
        <button
          type="button"
          disabled={stops.length === 0}
          className="rounded bg-sky-800/90 px-2 py-1 text-xs text-white hover:bg-sky-700 disabled:opacity-40"
          onClick={openWindy}
          title="Windy a tutta area come sfondo: traccia e tappe restano sopra. Chiudi con «Torna mappa OSM»."
        >
          Meteo Windy sulla mappa
        </button>
        <a
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          href={windyMainHref}
          target="_blank"
          rel="noreferrer"
        >
          windy.com ↗
        </a>
      </div>

      {!itinerary?.start_date || !itinerary?.end_date || stops.length === 0 ? (
        <p className="text-xs text-zinc-500">
          Imposta date itinerario e almeno una tappa per vedere le previsioni Open-Meteo (tabella sotto).
        </p>
      ) : null}

      {weatherForecast && weatherForecast.daily.length > 0 && (
        <div className="overflow-x-auto rounded border border-zinc-700/60">
          <table className="w-full min-w-[320px] border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-zinc-700 bg-zinc-950/80 text-zinc-400">
                <th className="px-2 py-1.5 font-medium">Data</th>
                <th className="px-2 py-1.5 font-medium">T min / max</th>
                <th className="px-2 py-1.5 font-medium">Pioggia max</th>
                <th className="px-2 py-1.5 font-medium">Vento max</th>
              </tr>
            </thead>
            <tbody>
              {weatherForecast.daily.map((d) => (
                <tr key={d.date} className="border-b border-zinc-800/80 text-zinc-300">
                  <td className="px-2 py-1.5 whitespace-nowrap">{d.date}</td>
                  <td className="px-2 py-1.5">
                    {d.temp_min_c.toFixed(0)}° / {d.temp_max_c.toFixed(0)}°C
                  </td>
                  <td className="px-2 py-1.5">{d.precip_mm_max.toFixed(1)} mm</td>
                  <td className="px-2 py-1.5">{d.wind_speed_max_ms.toFixed(1)} m/s</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-zinc-800 px-2 py-1 text-[10px] text-zinc-500">
            Coordinate: {weatherForecast.latitude.toFixed(2)}, {weatherForecast.longitude.toFixed(2)} (centro
            approssimativo itinerario)
          </p>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-xs font-medium text-zinc-400">Allerte (soglie profilo)</h3>
        {weatherAlerts.length === 0 ? (
          <p className="text-xs text-zinc-500">Nessuna allerta oltre le soglie.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-4 text-xs text-amber-200/95">
            {weatherAlerts.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
