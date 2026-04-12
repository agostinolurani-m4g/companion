"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, LineString } from "geojson";
import { activityToOsrmProfile, normalizeActivityForRouting } from "@/lib/osrm-route";
import { PlannerProvider, usePlanner } from "@/context/PlannerProvider";
import { MapView } from "@/components/MapView";
import { MapClickSheet, type MapPointKind } from "@/components/MapClickSheet";
import { MapStatsColumn } from "@/components/MapStatsColumn";
import { ChatPanel } from "@/components/ChatPanel";
import { BrowserPanel } from "@/components/BrowserPanel";
import { ElevationChart } from "@/components/ElevationChart";
import { ProfileModal } from "@/components/ProfileModal";
import { ExploreTab } from "@/components/ExploreTab";
import { ConfirmEmailModal } from "@/components/ConfirmEmailModal";
import { BookingConfirmModal } from "@/components/BookingConfirmModal";
import { MapActivitySettings } from "@/components/MapActivitySettings";
import { WeatherTabPanel } from "@/components/WeatherTabPanel";
import { StopEditSheet } from "@/components/StopEditSheet";
import type { StopRow } from "@/lib/types";

type Tab = "chat" | "explore" | "weather";

function Shell() {
  const {
    itineraries,
    activeItineraryId,
    itinerary,
    stops,
    mapPois,
    displayLine,
    selectItinerary,
    removeMapPoi,
    createNewItinerary,
    updateLineOnServer,
    refreshWeather,
    weatherAlerts,
    loadProfile,
    profile,
    hasGpxTrack,
  } = usePlanner();

  const osrmRequestSeq = useRef(0);
  const osrmRouteBaseline = useRef<{ itineraryId: string | null; key: string | null }>({
    itineraryId: null,
    key: null,
  });

  const stopsRouteKey = useMemo(() => {
    const sorted = [...stops].sort((a, b) => a.order_index - b.order_index);
    const pts = sorted.map((s) => `${s.id}:${s.lat}:${s.lng}`).join("|");
    return `${normalizeActivityForRouting(itinerary?.activity ?? "hiking")}|${pts}`;
  }, [stops, itinerary?.activity]);

  const [tab, setTab] = useState<Tab>("chat");
  const [profileOpen, setProfileOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [pendingWaypoint, setPendingWaypoint] = useState<{
    itineraryId: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [pendingName, setPendingName] = useState("Punto mappa");
  const [pendingPointKind, setPendingPointKind] = useState<MapPointKind>("waypoint");
  const [pendingImageUrl, setPendingImageUrl] = useState("");
  const [pendingWebsiteUrl, setPendingWebsiteUrl] = useState("");
  const [selectedStop, setSelectedStop] = useState<StopRow | null>(null);
  const [relocatingStopId, setRelocatingStopId] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<{
    track_id: string;
    distance_km: number;
    points: number;
  } | null>(null);

  useEffect(() => {
    setSelectedStop(null);
    setRelocatingStopId(null);
  }, [activeItineraryId]);

  useEffect(() => {
    if (!relocatingStopId) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRelocatingStopId(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [relocatingStopId]);

  const onStopSelect = useCallback((stop: StopRow) => {
    setPendingWaypoint(null);
    setSelectedStop(stop);
  }, []);

  const onStopDragEnd = useCallback(
    async (stopId: string, lng: number, lat: number) => {
      if (!activeItineraryId) return;
      const res = await fetch(`/api/itineraries/${activeItineraryId}/stops/${stopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      if (res.ok) await selectItinerary(activeItineraryId);
    },
    [activeItineraryId, selectItinerary]
  );

  const onMapBackgroundClick = useCallback(
    async (lng: number, lat: number) => {
      setSelectedStop(null);
      if (relocatingStopId && activeItineraryId) {
        const res = await fetch(`/api/itineraries/${activeItineraryId}/stops/${relocatingStopId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng }),
        });
        if (res.ok) {
          setRelocatingStopId(null);
          await selectItinerary(activeItineraryId);
        }
        return;
      }
      let id = activeItineraryId;
      if (!id) {
        id = await createNewItinerary();
      }
      if (!id) return;
      setPendingName("Punto mappa");
      setPendingPointKind("waypoint");
      setPendingImageUrl("");
      setPendingWebsiteUrl("");
      setPendingWaypoint({ itineraryId: id, lat, lng });
    },
    [activeItineraryId, createNewItinerary, relocatingStopId, selectItinerary]
  );

  const confirmPendingWaypoint = async () => {
    if (!pendingWaypoint) return;
    const name = pendingName.trim() || "Punto mappa";
    const segment_type =
      pendingPointKind === "destination" ? "stop" : pendingPointKind === "lodging" ? "lodging" : "poi";
    let image_url =
      pendingPointKind === "lodging" && pendingImageUrl.trim() ? pendingImageUrl.trim() : null;
    if (pendingPointKind === "lodging" && !image_url) {
      const r = await fetch(`/api/refuge-image?q=${encodeURIComponent(name)}`);
      if (r.ok) {
        const j = (await r.json()) as { image_url?: string | null };
        if (j.image_url) image_url = j.image_url;
      }
    }
    const website_url =
      pendingPointKind === "lodging" && pendingWebsiteUrl.trim()
        ? pendingWebsiteUrl.trim()
        : null;
    await fetch(`/api/itineraries/${pendingWaypoint.itineraryId}/stops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segment_type,
        name,
        lat: pendingWaypoint.lat,
        lng: pendingWaypoint.lng,
        image_url,
        website_url,
      }),
    });
    const id = pendingWaypoint.itineraryId;
    setPendingWaypoint(null);
    await selectItinerary(id);
  };

  const downloadGpx = async () => {
    if (!activeItineraryId) return;
    const res = await fetch("/api/gpx/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itineraryId: activeItineraryId }),
    });
    if (!res.ok) {
      alert("Esportazione GPX non riuscita (serve una traccia salvata).");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${itinerary?.name ?? "itinerario"}.gpx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importGpx = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".gpx,application/gpx+xml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !activeItineraryId) return;
      const xml = await file.text();
      const res = await fetch("/api/gpx/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml, itinerary_id: activeItineraryId }),
      });
      const j = (await res.json()) as {
        displayFeature?: Feature<LineString>;
        track_id?: string;
        summary?: { distance_m: number; point_count: number };
        error?: string;
        itinerary_line_updated?: boolean;
      };
      if (!res.ok || !j.displayFeature) {
        alert(j.error ?? "Import GPX fallito");
        return;
      }
      if (!j.itinerary_line_updated) {
        await updateLineOnServer(j.displayFeature as Feature<LineString>);
      } else {
        await selectItinerary(activeItineraryId);
      }
      if (j.track_id && j.summary) {
        setLastImport({
          track_id: j.track_id,
          distance_km: j.summary.distance_m / 1000,
          points: j.summary.point_count,
        });
      }
    };
    input.click();
  };

  const downloadIcs = async () => {
    if (!itinerary?.start_date || !itinerary.end_date) {
      alert("Imposta date itinerario (modifica o chiedi all’AI).");
      return;
    }
    const start = `${itinerary.start_date}T09:00:00.000Z`;
    const end = `${itinerary.end_date}T18:00:00.000Z`;
    const res = await fetch("/api/ics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: itinerary.name,
        start,
        end,
        description: `Itinerario ${itinerary.activity}`,
      }),
    });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${itinerary.name}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const routeStopsWithOsrm = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!activeItineraryId || stops.length < 2) return;
      if (hasGpxTrack && opts?.silent) return;

      const sorted = [...stops].sort((a, b) => a.order_index - b.order_index);
      const coordinates = sorted.map((s) => [s.lng, s.lat] as [number, number]);
      const activity = normalizeActivityForRouting(itinerary?.activity ?? "hiking");
      const profile = activityToOsrmProfile(activity);
      const seq = ++osrmRequestSeq.current;
      const res = await fetch("/api/route/osrm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinates,
          activity,
          profile,
        }),
      });
      const j = (await res.json()) as { feature?: Feature<LineString>; error?: string };
      if (seq !== osrmRequestSeq.current) return;
      if (res.ok && j.feature?.geometry?.type === "LineString") {
        await updateLineOnServer(j.feature);
        return;
      }
      if (!opts?.silent) {
        alert(
          j.error ??
            "OSRM non ha trovato un percorso tra queste tappe. Avvicina i punti lungo strade/sentieri in OpenStreetMap, oppure importa un GPX."
        );
      }
    },
    [activeItineraryId, stops, itinerary?.activity, hasGpxTrack, updateLineOnServer]
  );

  const routeStopsWithOsrmRef = useRef(routeStopsWithOsrm);
  routeStopsWithOsrmRef.current = routeStopsWithOsrm;

  /** Ricalcolo manuale (sostituisce anche la linea da GPX se serve). */
  const drawLineFromStops = () => void routeStopsWithOsrmRef.current({ silent: false });

  const savedLineGeojson = itinerary?.line_geojson ?? null;

  useEffect(() => {
    if (!activeItineraryId || stops.length < 2 || hasGpxTrack) return;

    const baseline = osrmRouteBaseline.current;
    if (baseline.itineraryId !== activeItineraryId) {
      osrmRouteBaseline.current = { itineraryId: activeItineraryId, key: stopsRouteKey };
      if (savedLineGeojson) return;
    } else if (baseline.key === stopsRouteKey) {
      return;
    } else {
      osrmRouteBaseline.current = { itineraryId: activeItineraryId, key: stopsRouteKey };
    }

    const t = window.setTimeout(() => {
      void routeStopsWithOsrmRef.current({ silent: true });
    }, 500);
    return () => clearTimeout(t);
  }, [activeItineraryId, stopsRouteKey, hasGpxTrack, savedLineGeojson]);

  return (
    <div className="flex h-[100dvh] flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <h1 className="text-sm font-semibold tracking-tight text-emerald-400">Trail Planner</h1>
        <select
          className="max-w-[200px] rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs"
          value={activeItineraryId ?? ""}
          onChange={(e) => void selectItinerary(e.target.value || null)}
        >
          <option value="">— Itinerario —</option>
          {itineraries.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
          onClick={() => void createNewItinerary()}
        >
          Nuovo
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
          onClick={() => setProfileOpen(true)}
        >
          Profilo
        </button>
        <span className="text-xs text-zinc-500">
          {profile?.display_name ? `Ciao, ${profile.display_name}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          <button
            type="button"
            className="rounded bg-zinc-800 px-2 py-1 text-xs"
            onClick={() => void downloadGpx()}
          >
            GPX ↓
          </button>
          <button type="button" className="rounded bg-zinc-800 px-2 py-1 text-xs" onClick={importGpx}>
            GPX ↑
          </button>
          <button type="button" className="rounded bg-zinc-800 px-2 py-1 text-xs" onClick={() => void downloadIcs()}>
            ICS
          </button>
          <button
            type="button"
            className="rounded bg-zinc-800 px-2 py-1 text-xs"
            title="Ricalcola subito il percorso OSRM (anche se hai importato GPX)"
            onClick={() => void drawLineFromStops()}
          >
            Traccia su strada
          </button>
          <button
            type="button"
            className="rounded bg-zinc-800 px-2 py-1 text-xs"
            onClick={() => setBookingOpen(true)}
          >
            Conferma prenotazione
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:flex-row">
        <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 md:max-w-[min(100%,520px)]">
          <BrowserPanel />
          <div className="flex shrink-0 gap-1 text-xs">
            {(["chat", "explore", "weather"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`rounded px-2 py-1 capitalize ${
                  tab === t ? "bg-emerald-800 text-white" : "bg-zinc-800 text-zinc-400"
                }`}
                onClick={() => {
                  setTab(t);
                  if (t === "weather") void refreshWeather();
                }}
              >
                {t === "chat" ? "Chat" : t === "explore" ? "Esplora" : "Meteo"}
              </button>
            ))}
          </div>
          {tab === "chat" && <ChatPanel />}
          {tab === "explore" && <ExploreTab />}
          {tab === "weather" && <WeatherTabPanel />}
        </section>

        <section className="flex min-h-0 min-w-0 flex-[1.25] flex-col gap-2 overflow-hidden">
          <MapActivitySettings />
          <div className="relative min-h-[280px] flex-1 sm:min-h-[320px] md:min-h-[380px]">
            {relocatingStopId && (
              <div className="pointer-events-auto absolute left-2 right-2 top-2 z-[26] flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-600/50 bg-sky-950/95 px-2 py-1.5 text-[11px] text-sky-100 shadow-lg backdrop-blur-sm">
                <span>Clicca sulla mappa per la nuova posizione della tappa.</span>
                <button
                  type="button"
                  className="rounded bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-600"
                  onClick={() => setRelocatingStopId(null)}
                >
                  Annulla
                </button>
              </div>
            )}
            <MapView
              className="h-full w-full min-h-0"
              displayLine={displayLine}
              stops={stops}
              mapPois={mapPois}
              activity={itinerary?.activity ?? "hiking"}
              itineraryId={activeItineraryId}
              onMapBackgroundClick={onMapBackgroundClick}
              onStopSelect={onStopSelect}
              onStopDragEnd={onStopDragEnd}
              allowStopDrag={!relocatingStopId}
              onRemoveMapPoi={removeMapPoi}
            />
            {selectedStop && activeItineraryId === selectedStop.itinerary_id && (
              <StopEditSheet
                stop={selectedStop}
                onClose={() => setSelectedStop(null)}
                onRemove={async () => {
                  if (!activeItineraryId) return;
                  await fetch(`/api/itineraries/${activeItineraryId}/stops/${selectedStop.id}`, {
                    method: "DELETE",
                  });
                  setSelectedStop(null);
                  await selectItinerary(activeItineraryId);
                }}
                onStartRelocate={() => {
                  setRelocatingStopId(selectedStop.id);
                  setSelectedStop(null);
                }}
                onSave={async (patch) => {
                  if (!activeItineraryId) return;
                  const res = await fetch(`/api/itineraries/${activeItineraryId}/stops/${selectedStop.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                  });
                  const j = (await res.json()) as { stop?: StopRow };
                  if (res.ok && j.stop) setSelectedStop(j.stop);
                  await selectItinerary(activeItineraryId);
                }}
              />
            )}
            <MapClickSheet
              open={!!pendingWaypoint}
              name={pendingName}
              onNameChange={setPendingName}
              pointKind={pendingPointKind}
              onPointKindChange={setPendingPointKind}
              imageUrl={pendingImageUrl}
              onImageUrlChange={setPendingImageUrl}
              websiteUrl={pendingWebsiteUrl}
              onWebsiteUrlChange={setPendingWebsiteUrl}
              onConfirm={() => void confirmPendingWaypoint()}
              onCancel={() => setPendingWaypoint(null)}
            />
          </div>
          <MapStatsColumn
            lastImport={lastImport}
            stopsCount={stops.length}
            weatherAlerts={weatherAlerts}
            onRefreshWeather={() => void refreshWeather()}
            onOpenWeatherTab={() => {
              setTab("weather");
              void refreshWeather();
            }}
          >
            <ElevationChart />
            {stops.length === 1 && (
              <p className="text-center text-[11px] text-zinc-500">
                Aggiungi almeno <strong className="text-zinc-400">una seconda tappa</strong> (o importa GPX) per
                poter disegnare un percorso.
              </p>
            )}
            {stops.length >= 2 && hasGpxTrack && (
              <p className="text-center text-[11px] text-zinc-500">
                Hai un <strong className="text-zinc-400">GPX</strong> collegato: la linea non viene ricalcolata da sola
                con OSRM. Usa <strong className="text-zinc-400">«Traccia su strada»</strong> se vuoi sostituirla con il
                routing da tappe.
              </p>
            )}
          </MapStatsColumn>
        </section>
      </div>

      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSaved={() => void loadProfile()}
      />
      <ConfirmEmailModal />
      <BookingConfirmModal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        title="Prenotazione / acquisto"
        detail="In MVP non ci sono integrazioni booking reali. Usa il mini browser per completare su siti esterni dopo aver verificato tu i dettagli."
      />
    </div>
  );
}

export function AppHome() {
  return (
    <PlannerProvider>
      <Shell />
    </PlannerProvider>
  );
}
