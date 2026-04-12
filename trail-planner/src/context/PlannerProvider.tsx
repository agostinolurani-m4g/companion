"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Feature, LineString } from "geojson";
import type { ItineraryRow, MapPoiRow, ProfileRow, StopRow } from "@/lib/types";
import type { PlannerToolEvent } from "@/lib/claude-planner";
import type { WeatherResponse } from "@/lib/weather";

function randomSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type PlannerContextValue = {
  sessionId: string;
  profile: ProfileRow | null;
  itineraries: ItineraryRow[];
  activeItineraryId: string | null;
  itinerary: ItineraryRow | null;
  stops: StopRow[];
  mapPois: MapPoiRow[];
  lineFeature: Feature<LineString> | null;
  displayLine: Feature<LineString> | null;
  browserUrl: string;
  setBrowserUrl: (u: string) => void;
  pendingBrowser: { url: string; title?: string } | null;
  setPendingBrowser: (p: { url: string; title?: string } | null) => void;
  draftEmail: { to: string; subject: string; body: string } | null;
  setDraftEmail: (d: { to: string; subject: string; body: string } | null) => void;
  weatherAlerts: string[];
  setWeatherAlerts: (a: string[]) => void;
  weatherForecast: WeatherResponse | null;
  windyOverlay: { lat: number; lng: number; zoom: number } | null;
  setWindyOverlay: (v: { lat: number; lng: number; zoom: number } | null) => void;
  loadProfile: () => Promise<void>;
  loadItineraries: () => Promise<void>;
  selectItinerary: (id: string | null) => Promise<void>;
  createNewItinerary: () => Promise<string | null>;
  updateLineOnServer: (feature: Feature<LineString> | null) => Promise<void>;
  /** Aggiorna solo l’attività (colore mappa + profilo OSRM per «Traccia su strada»). */
  updateItineraryActivity: (activity: string) => Promise<void>;
  addStopRemote: (lat: number, lng: number, name?: string) => Promise<void>;
  removeMapPoi: (poiId: string) => Promise<void>;
  refreshWeather: () => Promise<void>;
  /** Itinerario con almeno una traccia GPX importata collegata: non sovrascrivere con OSRM automatico. */
  hasGpxTrack: boolean;
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState("");
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [itineraries, setItineraries] = useState<ItineraryRow[]>([]);
  const [activeItineraryId, setActiveItineraryId] = useState<string | null>(null);
  const [itinerary, setItinerary] = useState<ItineraryRow | null>(null);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [mapPois, setMapPois] = useState<MapPoiRow[]>([]);
  const [browserUrl, setBrowserUrl] = useState("about:blank");
  const [pendingBrowser, setPendingBrowser] = useState<{ url: string; title?: string } | null>(
    null
  );
  const [draftEmail, setDraftEmail] = useState<{
    to: string;
    subject: string;
    body: string;
  } | null>(null);
  const [weatherAlerts, setWeatherAlerts] = useState<string[]>([]);
  const [weatherForecast, setWeatherForecast] = useState<WeatherResponse | null>(null);
  const [windyOverlay, setWindyOverlay] = useState<{
    lat: number;
    lng: number;
    zoom: number;
  } | null>(null);
  const [hasGpxTrack, setHasGpxTrack] = useState(false);

  useEffect(() => {
    const k = "trail-planner-session";
    let s = typeof window !== "undefined" ? window.localStorage.getItem(k) : null;
    if (!s) {
      s = randomSessionId();
      window.localStorage.setItem(k, s);
    }
    setSessionId(s);
  }, []);

  const lineFeature = useMemo((): Feature<LineString> | null => {
    if (!itinerary?.line_geojson) return null;
    try {
      const f = JSON.parse(itinerary.line_geojson) as Feature<LineString>;
      if (f?.geometry?.type === "LineString") return f;
    } catch {
      /* ignore */
    }
    return null;
  }, [itinerary?.line_geojson]);

  /** Solo traccia salvata (OSRM, GPX, AI): niente linea retta automatica tra le tappe. */
  const displayLine = useMemo((): Feature<LineString> | null => lineFeature, [lineFeature]);

  const loadProfile = useCallback(async () => {
    const res = await fetch("/api/profile");
    const j = (await res.json()) as { profile: ProfileRow };
    setProfile(j.profile);
  }, []);

  const loadItineraries = useCallback(async () => {
    const res = await fetch("/api/itineraries");
    const j = (await res.json()) as { itineraries: ItineraryRow[] };
    setItineraries(j.itineraries);
  }, []);

  const selectItinerary = useCallback(
    async (id: string | null) => {
      setActiveItineraryId(id);
      if (!id) {
        setItinerary(null);
        setStops([]);
        setMapPois([]);
        setHasGpxTrack(false);
        return;
      }
      const res = await fetch(`/api/itineraries/${id}`);
      if (!res.ok) return;
      const j = (await res.json()) as {
        itinerary: ItineraryRow;
        stops: StopRow[];
        map_pois?: MapPoiRow[];
        has_gpx_track?: boolean;
      };
      setItinerary(j.itinerary);
      setStops(j.stops);
      setMapPois(j.map_pois ?? []);
      setHasGpxTrack(j.has_gpx_track ?? false);
    },
    []
  );

  const createNewItinerary = useCallback(async () => {
    const name = `Itinerario ${new Date().toLocaleDateString("it-IT")}`;
    const res = await fetch("/api/itineraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, activity: "hiking" }),
    });
    const j = (await res.json()) as { itinerary: ItineraryRow };
    await loadItineraries();
    await selectItinerary(j.itinerary.id);
    return j.itinerary.id;
  }, [loadItineraries, selectItinerary]);

  const updateLineOnServer = useCallback(
    async (feature: Feature<LineString> | null) => {
      if (!activeItineraryId) return;
      const line_geojson = feature ? JSON.stringify(feature) : null;
      await fetch(`/api/itineraries/${activeItineraryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line_geojson }),
      });
      await selectItinerary(activeItineraryId);
    },
    [activeItineraryId, selectItinerary]
  );

  const updateItineraryActivity = useCallback(
    async (activity: string) => {
      if (!activeItineraryId) return;
      await fetch(`/api/itineraries/${activeItineraryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity }),
      });
      await selectItinerary(activeItineraryId);
    },
    [activeItineraryId, selectItinerary]
  );

  const addStopRemote = useCallback(
    async (lat: number, lng: number, name = "Punto mappa") => {
      if (!activeItineraryId) return;
      await fetch(`/api/itineraries/${activeItineraryId}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment_type: "poi",
          name,
          lat,
          lng,
        }),
      });
      await selectItinerary(activeItineraryId);
    },
    [activeItineraryId, selectItinerary]
  );

  const removeMapPoi = useCallback(
    async (poiId: string) => {
      if (!activeItineraryId) return;
      await fetch(`/api/itineraries/${activeItineraryId}/map-pois/${poiId}`, {
        method: "DELETE",
      });
      await selectItinerary(activeItineraryId);
    },
    [activeItineraryId, selectItinerary]
  );

  const refreshWeather = useCallback(async () => {
    if (!itinerary?.start_date || !itinerary.end_date || stops.length === 0) {
      setWeatherAlerts([]);
      return;
    }
    const mid = stops[Math.floor(stops.length / 2)];
    const lat = mid?.lat ?? 46.0;
    const lng = mid?.lng ?? 11.0;
    const u = new URL("/api/weather", window.location.origin);
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lng", String(lng));
    u.searchParams.set("start", itinerary.start_date!);
    u.searchParams.set("end", itinerary.end_date!);
    const res = await fetch(u.toString());
    const j = (await res.json()) as {
      alerts?: string[];
      forecast?: WeatherResponse;
      error?: string;
    };
    if (!res.ok) {
      setWeatherForecast(null);
      setWeatherAlerts([]);
      return;
    }
    setWeatherForecast(j.forecast ?? null);
    setWeatherAlerts(j.alerts ?? []);
  }, [itinerary?.start_date, itinerary?.end_date, stops]);

  useEffect(() => {
    void loadProfile();
    void loadItineraries();
  }, [loadProfile, loadItineraries]);

  useEffect(() => {
    void refreshWeather();
  }, [refreshWeather]);

  const value: PlannerContextValue = {
    sessionId,
    profile,
    itineraries,
    activeItineraryId,
    itinerary,
    stops,
    mapPois,
    lineFeature,
    displayLine,
    browserUrl,
    setBrowserUrl,
    pendingBrowser,
    setPendingBrowser,
    draftEmail,
    setDraftEmail,
    weatherAlerts,
    setWeatherAlerts,
    weatherForecast,
    windyOverlay,
    setWindyOverlay,
    loadProfile,
    loadItineraries,
    selectItinerary,
    createNewItinerary,
    updateLineOnServer,
    updateItineraryActivity,
    addStopRemote,
    removeMapPoi,
    refreshWeather,
    hasGpxTrack,
  };

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner() {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error("usePlanner dentro PlannerProvider");
  return ctx;
}

export type { PlannerToolEvent };
