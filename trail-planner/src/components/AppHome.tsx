"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, LineString } from "geojson";
import type { Position } from "geojson";
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
import { UserHubTab } from "@/components/UserHubTab";
import { ConfirmEmailModal } from "@/components/ConfirmEmailModal";
import { BookingConfirmModal } from "@/components/BookingConfirmModal";
import { MapActivitySettings } from "@/components/MapActivitySettings";
import { WeatherTabPanel } from "@/components/WeatherTabPanel";
import { StopEditSheet } from "@/components/StopEditSheet";
import { StopsSidebar, type RouteVisualizationMode } from "@/components/StopsSidebar";
import { RouteVariantTabs } from "@/components/RouteVariantTabs";
import { AvalancheInfoBar } from "@/components/AvalancheInfoBar";
import { BrandMark } from "@/components/BrandMark";
import {
  cumulativeKmAlong,
  kmAlongLineForStop,
  nearestPointOnPolyline,
  sliceCoordsByKmRange,
} from "@/lib/track-geometry";
import { appendInsertionOrderIndex, canStartNextLeg, maxLegIndex, sortStopsByOrder } from "@/lib/leg-stops";
import { DEFAULT_MAX_SNAP_KM, describeInsertionPreview } from "@/lib/stop-insertion";
import type { FeatureCollection } from "geojson";
import { DEMO_GROUP_CAI } from "@/lib/social-constants";
import type { TrailServicePoi } from "@/lib/overpass";
import { computeLegDayStats } from "@/lib/leg-day-stats";
import type { ExplorePlaceRow, StopRow } from "@/lib/types";

type Tab = "chat" | "explore" | "weather" | "me";

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
    mapPanelMode,
    setMapPanelMode,
    routeVariants,
  } = usePlanner();

  const activateRouteVariant = useCallback(
    async (variantId: string) => {
      if (!activeItineraryId) return;
      const res = await fetch(`/api/itineraries/${activeItineraryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_route_variant_id: variantId }),
      });
      if (res.ok) await selectItinerary(activeItineraryId);
    },
    [activeItineraryId, selectItinerary]
  );

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
  const [pendingPhone, setPendingPhone] = useState("");
  /** Giornata (0-based) in cui inserire il punto confermato dalla sheet. */
  const [pendingLegIndex, setPendingLegIndex] = useState(0);
  const [selectedStop, setSelectedStop] = useState<StopRow | null>(null);
  const [relocatingStopId, setRelocatingStopId] = useState<string | null>(null);
  const [routeViz, setRouteViz] = useState<{
    mode: RouteVisualizationMode;
    focusId: string | null;
  }>({ mode: "full", focusId: null });
  const [trackHoverKm, setTrackHoverKm] = useState<number | null>(null);
  const [trackHoverDistKm, setTrackHoverDistKm] = useState(Number.POSITIVE_INFINITY);
  const [mapWaterPois, setMapWaterPois] = useState<{ lat: number; lng: number }[]>([]);
  const [mapServicePois, setMapServicePois] = useState<TrailServicePoi[]>([]);
  const [flyToRequest, setFlyToRequest] = useState<{ lng: number; lat: number; zoom?: number } | null>(
    null
  );
  const [lastImport, setLastImport] = useState<{
    track_id: string;
    distance_km: number;
    points: number;
  } | null>(null);
  const [routeComputing, setRouteComputing] = useState(false);

  const [socialMapLayer, setSocialMapLayer] = useState<
    "off" | "friends" | "group" | "following" | "public"
  >("off");
  const [socialFeedGeojson, setSocialFeedGeojson] = useState<FeatureCollection | null>(null);
  const [socialFeedBump, setSocialFeedBump] = useState(0);
  const [explorePlaces, setExplorePlaces] = useState<ExplorePlaceRow[]>([]);
  const [outingBump, setOutingBump] = useState(0);

  const loadExplorePlaces = useCallback(async () => {
    const res = await fetch("/api/explore");
    const j = (await res.json()) as { places?: ExplorePlaceRow[] };
    setExplorePlaces(j.places ?? []);
  }, []);

  useEffect(() => {
    void loadExplorePlaces();
  }, [loadExplorePlaces]);

  useEffect(() => {
    if (socialMapLayer === "off" || !profile?.active_user_id) {
      setSocialFeedGeojson(null);
      return;
    }
    let cancelled = false;
    const u = new URL("/api/social/feed-map", window.location.origin);
    u.searchParams.set("layer", socialMapLayer);
    if (socialMapLayer === "group") u.searchParams.set("groupId", DEMO_GROUP_CAI);
    void (async () => {
      const res = await fetch(u.toString());
      const j = (await res.json()) as { geojson?: FeatureCollection; error?: string };
      if (cancelled) return;
      if (res.ok && j.geojson) setSocialFeedGeojson(j.geojson);
      else setSocialFeedGeojson(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [socialMapLayer, profile?.active_user_id, socialFeedBump]);

  useEffect(() => {
    setSelectedStop(null);
    setRelocatingStopId(null);
    setRouteViz({ mode: "full", focusId: null });
    setTrackHoverKm(null);
    setTrackHoverDistKm(Number.POSITIVE_INFINITY);
    setMapWaterPois([]);
    setMapServicePois([]);
  }, [activeItineraryId]);

  const sortedStops = useMemo(() => sortStopsByOrder(stops), [stops]);

  const maxAllowedLegIndex = useMemo(() => {
    const ml = maxLegIndex(sortedStops);
    if (ml < 0) return 0;
    return canStartNextLeg(sortedStops) ? ml + 1 : ml;
  }, [sortedStops]);

  const legDayOptions = useMemo(() => {
    const ml = maxLegIndex(sortedStops);
    const seen = new Set<number>();
    for (const s of sortedStops) seen.add(s.leg_index ?? 0);
    const sortedLegs = [...seen].sort((a, b) => a - b);
    const opts = sortedLegs.map((L) => ({ value: L, label: `Giorno ${L + 1}` }));
    if (sortedStops.length === 0) {
      return [{ value: 0, label: "Giorno 1" }];
    }
    if (canStartNextLeg(sortedStops) && ml >= 0) {
      opts.push({ value: ml + 1, label: `Giorno ${ml + 2} (nuovo)` });
    }
    return opts.length ? opts : [{ value: 0, label: "Giorno 1" }];
  }, [sortedStops]);

  useEffect(() => {
    if (pendingLegIndex > maxAllowedLegIndex) setPendingLegIndex(maxAllowedLegIndex);
  }, [pendingLegIndex, maxAllowedLegIndex]);

  const fullCoords = useMemo((): Position[] | null => {
    const c = displayLine?.geometry?.coordinates;
    if (!c?.length) return null;
    return c as Position[];
  }, [displayLine]);

  const legDayStats = useMemo(
    () => (stops.length ? computeLegDayStats(stops, fullCoords) : []),
    [stops, fullCoords]
  );

  const pendingInsertionPreview = useMemo(() => {
    if (!pendingWaypoint) return { line: "", warn: null as string | null };
    const { lat, lng } = pendingWaypoint;
    const k = appendInsertionOrderIndex(sortedStops, pendingLegIndex);
    const line = describeInsertionPreview(sortedStops, k, "auto");
    let warn: string | null = null;
    if (fullCoords && fullCoords.length >= 2) {
      const hit = nearestPointOnPolyline(fullCoords, [lng, lat]);
      if (!hit || hit.distKm > DEFAULT_MAX_SNAP_KM) {
        warn = `Sei oltre ~${DEFAULT_MAX_SNAP_KM} km dalla traccia salvata: l’ordine nella giornata segue l’elenco tappe, non la proiezione sulla curva.`;
      }
    }
    return { line, warn };
  }, [pendingWaypoint, sortedStops, fullCoords, pendingLegIndex]);

  const derivedRoute = useMemo(() => {
    if (!displayLine || !fullCoords || fullCoords.length < 2) {
      return {
        lineForMap: displayLine,
        visibleStopIds: null as Set<string> | null,
        vizKmRange: null as { startKm: number; endKm: number } | null,
        stopMeta: [] as { id: string; name: string; km: number }[],
      };
    }
    const cumLast = cumulativeKmAlong(fullCoords)[fullCoords.length - 1];
    const stopMeta = sortedStops.map((s) => ({
      id: s.id,
      name: s.name,
      km: kmAlongLineForStop(s.lng, s.lat, fullCoords) ?? 0,
    }));

    const { mode, focusId } = routeViz;
    if (mode === "full" || !focusId) {
      return { lineForMap: displayLine, visibleStopIds: null, vizKmRange: null, stopMeta };
    }

    const focus = sortedStops.find((s) => s.id === focusId);
    if (!focus) {
      return { lineForMap: displayLine, visibleStopIds: null, vizKmRange: null, stopMeta };
    }

    const kmF = kmAlongLineForStop(focus.lng, focus.lat, fullCoords);
    if (kmF == null) {
      return { lineForMap: displayLine, visibleStopIds: null, vizKmRange: null, stopMeta };
    }

    const idx = sortedStops.findIndex((s) => s.id === focusId);

    if (mode === "stop_only") {
      return {
        lineForMap: displayLine,
        visibleStopIds: new Set([focusId]),
        vizKmRange: null,
        stopMeta,
      };
    }

    if (mode === "from_stop") {
      const sliced = sliceCoordsByKmRange(fullCoords, kmF, cumLast);
      const lineForMap: Feature<LineString> = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: sliced },
      };
      const vis = new Set(
        sortedStops.filter((s) => s.order_index >= focus.order_index).map((s) => s.id)
      );
      return {
        lineForMap,
        visibleStopIds: vis,
        vizKmRange: { startKm: kmF, endKm: cumLast },
        stopMeta,
      };
    }

    if (mode === "leg_to_next") {
      const next = sortedStops[idx + 1];
      if (!next) {
        return {
          lineForMap: displayLine,
          visibleStopIds: new Set([focusId]),
          vizKmRange: { startKm: kmF, endKm: kmF },
          stopMeta,
        };
      }
      const kmN = kmAlongLineForStop(next.lng, next.lat, fullCoords) ?? kmF;
      const lo = Math.min(kmF, kmN);
      const hi = Math.max(kmF, kmN);
      const sliced = sliceCoordsByKmRange(fullCoords, lo, hi);
      const lineForMap: Feature<LineString> = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: sliced },
      };
      return {
        lineForMap,
        visibleStopIds: new Set([focus.id, next.id]),
        vizKmRange: { startKm: lo, endKm: hi },
        stopMeta,
      };
    }

    return { lineForMap: displayLine, visibleStopIds: null, vizKmRange: null, stopMeta };
  }, [displayLine, fullCoords, sortedStops, routeViz]);

  const onFlyToConsumed = useCallback(() => setFlyToRequest(null), []);

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
      setPendingPhone("");
      const sortedNow = sortStopsByOrder(stops);
      const ml = maxLegIndex(sortedNow);
      setPendingLegIndex(ml >= 0 ? ml : 0);
      setPendingWaypoint({ itineraryId: id, lat, lng });
    },
    [activeItineraryId, createNewItinerary, relocatingStopId, selectItinerary, stops]
  );

  const confirmPendingWaypoint = async () => {
    if (!pendingWaypoint) return;
    if (pendingLegIndex < 0 || pendingLegIndex > maxAllowedLegIndex) {
      alert("Seleziona una giornata valida.");
      return;
    }
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
    const phone =
      pendingPointKind === "lodging" && pendingPhone.trim() ? pendingPhone.trim() : null;
    const body: Record<string, unknown> = {
      segment_type,
      name,
      lat: pendingWaypoint.lat,
      lng: pendingWaypoint.lng,
      image_url,
      website_url,
      phone,
      leg_index: pendingLegIndex,
    };
    await fetch(`/api/itineraries/${pendingWaypoint.itineraryId}/stops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
      setRouteComputing(true);
      try {
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
      } finally {
        if (seq === osrmRequestSeq.current) setRouteComputing(false);
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
    <div className="flex h-[100dvh] flex-col bg-brand-bg text-brand-text">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-brand-border px-3 py-2.5">
        <BrandMark className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:max-w-md">
          <label className="sr-only" htmlFor="itinerary-select">
            Itinerario attivo
          </label>
          <select
            id="itinerary-select"
            className="min-w-0 max-w-[min(100%,220px)] flex-1 rounded-lg border border-brand-border bg-brand-surface px-2.5 py-1.5 text-xs text-brand-text focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/40"
            value={activeItineraryId ?? ""}
            onChange={(e) => void selectItinerary(e.target.value || null)}
          >
            <option value="">Scegli itinerario…</option>
            {itineraries.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-lg border border-brand-border bg-brand-elevated px-2.5 py-1.5 text-xs font-medium text-brand-text hover:bg-brand-border/60"
            onClick={() => void createNewItinerary()}
          >
            Nuovo
          </button>
          <button
            type="button"
            className="rounded-lg border border-brand-border bg-brand-elevated px-2.5 py-1.5 text-xs font-medium text-brand-text hover:bg-brand-border/60"
            onClick={() => setProfileOpen(true)}
          >
            Profilo
          </button>
        </div>
        {profile?.display_name ? (
          <span className="hidden text-xs text-brand-muted sm:inline">{profile.display_name}</span>
        ) : null}
        <div className="flex w-full flex-wrap gap-1 gap-y-1.5 sm:ml-auto sm:w-auto">
          <button
            type="button"
            disabled={!activeItineraryId}
            title={activeItineraryId ? "Scarica traccia GPX" : "Seleziona o crea un itinerario"}
            className="tp-btn-tool"
            onClick={() => void downloadGpx()}
          >
            GPX ↓
          </button>
          <button
            type="button"
            disabled={!activeItineraryId}
            title={activeItineraryId ? "Importa file GPX" : "Seleziona o crea un itinerario"}
            className="tp-btn-tool"
            onClick={importGpx}
          >
            GPX ↑
          </button>
          <button
            type="button"
            disabled={!activeItineraryId}
            title={activeItineraryId ? "Calendario (.ics)" : "Seleziona o crea un itinerario"}
            className="tp-btn-tool"
            onClick={() => void downloadIcs()}
          >
            ICS
          </button>
          <button
            type="button"
            disabled={!activeItineraryId || stops.length < 2}
            className="tp-btn-tool"
            title="Ricalcola il percorso sulle strade (OSRM)"
            onClick={() => void drawLineFromStops()}
          >
            OSRM
          </button>
          <button
            type="button"
            className="tp-btn-tool text-brand-muted hover:text-brand-text"
            title="Info prenotazioni (demo)"
            onClick={() => setBookingOpen(true)}
          >
            Prenota
          </button>
        </div>
      </header>

      {!activeItineraryId ? (
        <div className="shrink-0 border-b border-brand-accent/20 bg-brand-accent-dim px-3 py-2.5 text-[11px] leading-relaxed text-brand-muted">
          <span className="font-medium text-brand-accent">Per iniziare</span> — scegli un itinerario sopra, oppure{" "}
          <span className="text-brand-text">Nuovo</span> o un punto sulla mappa. La chat pianifica con te;{" "}
          <span className="text-brand-text">GPX ↑</span> importa una traccia.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:flex-row">
        <section
          className={`flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 ${
            mapPanelMode === "hidden" ? "md:max-w-none md:flex-[2]" : "md:max-w-[min(100%,520px)]"
          }`}
        >
          <BrowserPanel />
          <nav
            className="flex shrink-0 gap-1 p-0.5"
            aria-label="Sezioni principali"
          >
            {(["chat", "explore", "weather", "me"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`tp-tab ${tab === t ? "tp-tab-active" : "tp-tab-inactive"}`}
                onClick={() => {
                  setTab(t);
                  if (t === "weather") void refreshWeather();
                }}
              >
                {t === "chat"
                  ? "Chat"
                  : t === "explore"
                    ? "Esplora"
                    : t === "weather"
                      ? "Meteo"
                      : "Io"}
              </button>
            ))}
          </nav>
          {tab === "chat" && <ChatPanel />}
          {tab === "explore" && (
            <ExploreTab
              places={explorePlaces}
              onRefresh={loadExplorePlaces}
              onOpenChat={() => setTab("chat")}
              onStartNewItinerary={() => void createNewItinerary()}
              onFlyToPlace={(lat, lng) => {
                setFlyToRequest({ lng, lat, zoom: 12 });
                setMapPanelMode("expanded");
              }}
            />
          )}
          {tab === "me" && (
            <UserHubTab
              itineraries={itineraries}
              onSelectItinerary={(id) => void selectItinerary(id)}
              onOpenProfile={() => setProfileOpen(true)}
              refreshKey={`${profile?.active_user_id ?? ""}-${outingBump}`}
              socialMapLayer={socialMapLayer}
              onSocialMapLayerChange={setSocialMapLayer}
              onShowSocialOnMap={(layer) => {
                setSocialMapLayer(layer);
                setMapPanelMode("expanded");
              }}
            />
          )}
          {tab === "weather" && <WeatherTabPanel />}
        </section>

        <section
          className={`flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden ${
            mapPanelMode === "hidden" ? "md:max-w-md md:shrink-0" : "flex-[1.25]"
          }`}
        >
          <div className="flex flex-wrap items-end justify-between gap-2">
            <RouteVariantTabs
              variants={routeVariants}
              activeVariantId={itinerary?.active_route_variant_id ?? null}
              onSelect={(id) => void activateRouteVariant(id)}
            />
            <label className="flex items-center gap-1 text-[10px] text-brand-muted">
              <span className="shrink-0 text-brand-faint">Social</span>
              <select
                className="max-w-[130px] rounded-lg border border-brand-border bg-brand-surface px-1.5 py-0.5 text-[10px] text-brand-text focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                value={socialMapLayer}
                onChange={(e) =>
                  setSocialMapLayer(e.target.value as typeof socialMapLayer)
                }
                title="Percorsi di uscite recenti (POC locale)"
              >
                <option value="off">Spento</option>
                <option value="friends">Amici</option>
                <option value="group">Gruppo CAI</option>
                <option value="following">Seguiti</option>
                <option value="public">Pubblico</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-0.5">
              <button
                type="button"
                title="Mappa compatta"
                className={`rounded-lg px-2 py-0.5 text-[10px] font-medium ${
                  mapPanelMode === "compact"
                    ? "bg-brand-accent-dim text-brand-accent ring-1 ring-brand-accent/35"
                    : "bg-brand-elevated text-brand-muted hover:bg-brand-border/50 hover:text-brand-text"
                }`}
                onClick={() => setMapPanelMode("compact")}
              >
                Compatta
              </button>
              <button
                type="button"
                title="Mappa grande"
                className={`rounded-lg px-2 py-0.5 text-[10px] font-medium ${
                  mapPanelMode === "expanded"
                    ? "bg-brand-accent-dim text-brand-accent ring-1 ring-brand-accent/35"
                    : "bg-brand-elevated text-brand-muted hover:bg-brand-border/50 hover:text-brand-text"
                }`}
                onClick={() => setMapPanelMode("expanded")}
              >
                Grande
              </button>
              <button
                type="button"
                title="Nascondi mappa"
                className={`rounded-lg px-2 py-0.5 text-[10px] font-medium ${
                  mapPanelMode === "hidden"
                    ? "bg-brand-accent-dim text-brand-accent ring-1 ring-brand-accent/35"
                    : "bg-brand-elevated text-brand-muted hover:bg-brand-border/50 hover:text-brand-text"
                }`}
                onClick={() => setMapPanelMode("hidden")}
              >
                Nascondi
              </button>
            </div>
          </div>
          <AvalancheInfoBar activity={itinerary?.activity ?? "hiking"} stops={stops} />
          <MapActivitySettings />
          <div
            className={`flex overflow-hidden rounded-lg border border-zinc-700/50 transition-[min-height] duration-200 ${
              mapPanelMode === "hidden"
                ? "min-h-[140px] shrink-0"
                : mapPanelMode === "compact"
                  ? "h-[min(240px,42vh)] min-h-[200px] max-h-[280px] shrink-0"
                  : "min-h-[280px] flex-1 sm:min-h-[320px] md:min-h-[380px]"
            }`}
          >
            {mapPanelMode === "hidden" ? (
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-brand-bg/90 px-4 py-6 text-center">
                  <p className="text-[11px] text-brand-muted">Mappa nascosta — più spazio per chat.</p>
                  <button
                    type="button"
                    className="rounded-lg bg-brand-accent px-3 py-1.5 text-xs font-medium text-brand-bg hover:brightness-110"
                    onClick={() => setMapPanelMode("compact")}
                  >
                    Mostra mappa
                  </button>
                </div>
                <StopsSidebar
                  stops={stops}
                  focusStopId={routeViz.focusId}
                  vizMode={routeViz.mode}
                  onVizModeChange={(mode, focusId) => setRouteViz({ mode, focusId })}
                  onStopClick={(s) => {
                    setPendingWaypoint(null);
                    setSelectedStop(s);
                  }}
                  onFlyToStop={(s) => setFlyToRequest({ lng: s.lng, lat: s.lat, zoom: 14 })}
                  hasActiveItinerary={!!activeItineraryId}
                  onReorderLeg={async (legIndex, orderedIds) => {
                    if (!activeItineraryId) return;
                    const res = await fetch(`/api/itineraries/${activeItineraryId}/stops/reorder`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ orderedIds, legIndex }),
                    });
                    if (res.ok) await selectItinerary(activeItineraryId);
                  }}
                />
              </div>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="relative min-h-0 min-w-0 flex-1">
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
                    mapPanelMode={mapPanelMode}
                    socialFeedGeojson={socialFeedGeojson}
                    displayLine={derivedRoute.lineForMap}
                    stops={stops}
                    mapPois={mapPois}
                    activity={itinerary?.activity ?? "hiking"}
                    itineraryId={activeItineraryId}
                    visibleStopIds={derivedRoute.visibleStopIds}
                    fullLineCoords={fullCoords}
                    onTrackHover={(s) => {
                      setTrackHoverKm(s.alongKm);
                      setTrackHoverDistKm(s.distKm);
                    }}
                    flyToRequest={flyToRequest}
                    onFlyToRequestConsumed={onFlyToConsumed}
                    onMapBackgroundClick={onMapBackgroundClick}
                    onStopSelect={onStopSelect}
                    onStopDragEnd={onStopDragEnd}
                    allowStopDrag={!relocatingStopId}
                    onRemoveMapPoi={removeMapPoi}
                    osmWaterPois={mapWaterPois}
                    osmServicePois={mapServicePois}
                    catalogExplorePlaces={explorePlaces}
                  />
                  {selectedStop && activeItineraryId === selectedStop.itinerary_id && (
                    <StopEditSheet
                      stop={selectedStop}
                      stopIndex={Math.max(
                        0,
                        sortedStops.findIndex((s) => s.id === selectedStop.id)
                      )}
                      stopsTotal={sortedStops.length}
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
                    phone={pendingPhone}
                    onPhoneChange={setPendingPhone}
                    legDayIndex={pendingLegIndex}
                    legDayOptions={legDayOptions}
                    onLegDayIndexChange={setPendingLegIndex}
                    insertionPreviewLine={pendingInsertionPreview.line}
                    insertionWarning={pendingInsertionPreview.warn}
                    onConfirm={() => void confirmPendingWaypoint()}
                    onCancel={() => setPendingWaypoint(null)}
                  />
                </div>
                <StopsSidebar
                  stops={stops}
                  focusStopId={routeViz.focusId}
                  vizMode={routeViz.mode}
                  onVizModeChange={(mode, focusId) => setRouteViz({ mode, focusId })}
                  onStopClick={(s) => {
                    setPendingWaypoint(null);
                    setSelectedStop(s);
                  }}
                  onFlyToStop={(s) => setFlyToRequest({ lng: s.lng, lat: s.lat, zoom: 14 })}
                  hasActiveItinerary={!!activeItineraryId}
                  onReorderLeg={async (legIndex, orderedIds) => {
                    if (!activeItineraryId) return;
                    const res = await fetch(`/api/itineraries/${activeItineraryId}/stops/reorder`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ orderedIds, legIndex }),
                    });
                    if (res.ok) await selectItinerary(activeItineraryId);
                  }}
                />
              </div>
            )}
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
            onWaterForMap={setMapWaterPois}
            onServicesForMap={setMapServicePois}
            routeComputing={routeComputing}
            legDayStats={legDayStats}
            activeItineraryId={activeItineraryId}
            hasActiveUser={!!profile?.active_user_id}
            hasLineOnMap={!!itinerary?.line_geojson?.trim()}
            onOutingPublished={() => {
              setOutingBump((x) => x + 1);
              setSocialFeedBump((x) => x + 1);
            }}
          >
            <ElevationChart
              hoverKm={trackHoverKm}
              hoverDistKm={trackHoverDistKm}
              vizRange={derivedRoute.vizKmRange}
              stopMarkers={derivedRoute.stopMeta}
            />
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
