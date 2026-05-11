"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  CheckpointRow,
  NotableSectionRow,
  PoiCategory,
  PoiRow,
  RacePlanItemRow,
  RacePlanWithItems,
  ResupplyRow,
  TrackSurfaceSegmentRow,
} from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import type { MapillaryAlongItem, StreetViewAlongItem } from "@/lib/along-media-types";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import {
  formatTerrainIt,
  surfaceKindAtKm,
} from "@/lib/surface-osm";
import { coordAtKm, measureBetween, projectLngLatToTrack } from "@/lib/track-measure";
import { getHmrWideRailSnapshot, subscribeHmrWideRail } from "@/lib/hmr-wide-rail";
import BottomSheet, { type SheetSnap } from "./BottomSheet";
import DashboardHere from "./DashboardHere";
import PoiList from "./PoiList";
import CheckpointsPanel from "./CheckpointsPanel";
import ElevationChart from "./ElevationChart";
import MapView from "./MapView";
import AddPoiSheet from "./AddPoiSheet";
import RacePlanPanel from "./RacePlanPanel";
import AlongMediaControls from "./AlongMediaControls";
import OfflineStatus from "./OfflineStatus";
import RoadbookPanel from "./RoadbookPanel";
import RaceBriefPanel from "./RaceBriefPanel";

export type HmrTab = "dashboard" | "race" | "roadbook" | "list" | "checkpoints" | "racePlan";
type Tab = HmrTab;

export type TrackPayload = {
  id: string;
  name: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  /** Da ingest: riallinea misure A→B al D+ ufficiale (GPX grezzo). Default 1 se DB vecchio. */
  elev_profile_gain_scale: number;
  elev_profile_loss_scale: number;
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  coords: StoredCoord[];
  checkpoints: CheckpointRow[];
  resupply: ResupplyRow[];
  sections: NotableSectionRow[];
  pois: PoiRow[];
  /** Piani gara (annotazioni); default [] se assente. */
  racePlans?: RacePlanWithItems[];
  /** Superficie percorso (OSM); default [] finché non esegui `npm run snapshot:surface`. */
  surfaceSegments?: TrackSurfaceSegmentRow[];
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px] uppercase tracking-wide text-[color:var(--hmr-faint)]">{label}</span>
      <span className="text-xs font-medium text-[color:var(--hmr-text)]">{value}</span>
    </div>
  );
}

function labelForCategory(cat: PoiCategory): string {
  return CATEGORY_META[cat]?.label ?? cat;
}

type MapSurfaceKmSummary = {
  asphalt: number;
  gravel: number;
  single: number;
  unknown: number;
};

function MapChromeControls({
  variant,
  trackName,
  lengthKm,
  elevGainM,
  elevLossM,
  sessionEmail,
  surfaceKm,
  showSections,
  onToggleSections,
  showResupply,
  onToggleResupply,
  onOpenAddSheet,
  poiHarvestMode,
  poiHarvestBusy,
  onTogglePoiHarvest,
  visibleCategories,
  onToggleCategory,
}: {
  variant: "overlay" | "rail";
  trackName: string;
  lengthKm: number;
  elevGainM: number;
  elevLossM: number;
  sessionEmail: string;
  surfaceKm: MapSurfaceKmSummary;
  showSections: boolean;
  onToggleSections: () => void;
  showResupply: boolean;
  onToggleResupply: () => void;
  onOpenAddSheet: () => void;
  poiHarvestMode: boolean;
  poiHarvestBusy: boolean;
  onTogglePoiHarvest: () => void;
  visibleCategories: Set<PoiCategory>;
  onToggleCategory: (c: PoiCategory) => void;
}) {
  const popX = variant === "rail" ? "left-0" : "right-0";
  const infoBlockAlign = variant === "rail" ? "text-left" : "text-right";
  const trailColAlign = variant === "rail" ? "items-start" : "items-end";

  return (
    <>
      <div
        className={`pointer-events-auto hmr-panel flex items-center shadow-lg ${
          variant === "rail" ? "gap-2 px-2 py-1.5" : "gap-3 px-3 py-2"
        }`}
      >
            <div className="flex min-w-0 flex-col">
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--hmr-muted)]">
                HMR 2026
              </span>
              <span className="truncate text-xs font-bold tracking-tight sm:text-sm">{trackName}</span>
            </div>
            <div className={`ml-auto flex min-w-0 flex-col gap-1 ${trailColAlign}`}>
              <div
                className={`flex flex-wrap items-center gap-2 text-[9px] text-[color:var(--hmr-faint)] ${
                  variant === "rail" ? "justify-start" : "justify-end"
                }`}
              >
                <span className="max-w-[11rem] truncate">{sessionEmail}</span>
                <button
                  type="button"
                  onClick={() => {
                    void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
                      window.location.reload();
                    });
                  }}
                  className="hmr-btn hmr-tap rounded-none px-2 py-0.5 text-[10px]"
                >
                  Esci
                </button>
              </div>
              <details className={`relative ${infoBlockAlign}`}>
                <summary className="cursor-pointer list-none text-[10px] text-[color:var(--hmr-muted)] underline decoration-dotted underline-offset-2 select-none [&::-webkit-details-marker]:hidden">
                  Info traccia
                </summary>
                <div
                  className={`hmr-panel absolute ${popX} z-40 mt-1 min-w-[12rem] rounded-none border border-[color:var(--hmr-border)]/80 p-2 text-left text-[10px] font-semibold tracking-tight shadow-xl`}
                >
                  <div className="grid grid-cols-3 gap-2 text-[color:var(--hmr-muted)]">
                    <Stat label="Dist." value={`${lengthKm.toFixed(0)} km`} />
                    <Stat label="D+" value={`${Math.round(elevGainM)} m`} />
                    <Stat label="D-" value={`${Math.round(elevLossM)} m`} />
                  </div>
                  {(surfaceKm.asphalt + surfaceKm.gravel + surfaceKm.single + surfaceKm.unknown) >
                    0.5 && (
                    <div className="mt-2 border-t border-[color:var(--hmr-border)]/50 pt-2 text-[9px] leading-tight text-[color:var(--hmr-faint)]">
                      Strada: asfalto {surfaceKm.asphalt.toFixed(0)} km · sterrato{" "}
                      {surfaceKm.gravel.toFixed(0)} km · single {surfaceKm.single.toFixed(0)} km
                      {surfaceKm.unknown > 2 ? ` · n/d ${surfaceKm.unknown.toFixed(0)} km` : ""}
                    </div>
                  )}
                </div>
              </details>
            </div>
          </div>
      <div className={`pointer-events-auto flex flex-wrap items-start ${variant === "rail" ? "gap-1" : "gap-2"}`}>
            <button
              type="button"
              onClick={onToggleSections}
              className={`hmr-chip ${showSections ? "hmr-chip-on" : "hmr-chip-off"}`}
            >
              Toughest
            </button>
            <button
              type="button"
              onClick={onToggleResupply}
              className={`hmr-chip ${showResupply ? "hmr-chip-on" : "hmr-chip-off"}`}
            >
              Resupply
            </button>
            <button
              type="button"
              onClick={onOpenAddSheet}
              className="hmr-chip hmr-chip-off"
              aria-label="Aggiungi POI da link Google Maps"
            >
              Aggiungi
            </button>
            <button
              type="button"
              onClick={onTogglePoiHarvest}
              disabled={poiHarvestBusy}
              className={`hmr-chip ${poiHarvestMode ? "hmr-chip-on" : "hmr-chip-off"}`}
              aria-pressed={poiHarvestMode}
              title="Clic sulla mappa: cerca su OpenStreetMap nel raggio (~450 m) le categorie selezionate nel pannello verde"
            >
              {poiHarvestBusy ? "OSM…" : "OSM qui"}
            </button>
            <details className="relative">
              <summary className="hmr-chip hmr-chip-off cursor-pointer list-none select-none">
                Filtri POI
              </summary>
              <div
                className={`hmr-panel absolute ${popX} z-40 mt-2 w-44 rounded-none border border-[color:var(--hmr-border)]/80 p-2 text-xs font-semibold tracking-tight shadow-xl`}
              >
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-[color:var(--hmr-faint)]">
                  Mostra categorie
                </p>
                <div className="space-y-1">
                  {CATEGORY_ORDER.map((cat) => (
                    <label key={cat} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={visibleCategories.has(cat)}
                        onChange={() => onToggleCategory(cat)}
                      />
                      <span>{labelForCategory(cat)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          </div>
    </>
  );
}

export default function HmrApp({
  initial,
  sessionEmail,
  initialTab = "dashboard",
}: {
  initial: TrackPayload;
  sessionEmail: string;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [visibleCategories, setVisibleCategories] = useState<Set<PoiCategory>>(
    () => new Set<PoiCategory>(CATEGORY_ORDER)
  );
  const [showResupply, setShowResupply] = useState(true);
  const [showSections, setShowSections] = useState(true);
  const [pois, setPois] = useState<PoiRow[]>(initial.pois);
  const [racePlans, setRacePlans] = useState<RacePlanWithItems[]>(() => initial.racePlans ?? []);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(() => {
    const plans = initial.racePlans ?? [];
    return plans[0]?.id ?? null;
  });
  const [racePlanMapPick, setRacePlanMapPick] = useState(false);
  /** Default SSR-safe; valore da localStorage dopo mount (evita hydration mismatch). */
  const [showRacePlanOverlay, setShowRacePlanOverlay] = useState(true);
  const [mapPickedKm, setMapPickedKm] = useState<number | null>(null);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [addPoiMapPick, setAddPoiMapPick] = useState(false);
  const [addPoiPickedLatLng, setAddPoiPickedLatLng] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [raceActive, setRaceActive] = useState(false);

  useEffect(() => {
    try {
      setRaceActive(localStorage.getItem("hmr_race_active") === "1");
    } catch {
      setRaceActive(false);
    }
  }, []);

  useEffect(() => {
    const key = `hmr_race_plan_overlay:${initial.id}`;
    try {
      const v = localStorage.getItem(key);
      if (v === "0") setShowRacePlanOverlay(false);
      else if (v === "1") setShowRacePlanOverlay(true);
    } catch {
      /* ignore */
    }
  }, [initial.id]);

  const startRace = useCallback(() => {
    try {
      localStorage.setItem("hmr_race_active", "1");
    } catch {
      /* ignore */
    }
    setRaceActive(true);
  }, []);

  const endRace = useCallback(() => {
    try {
      localStorage.removeItem("hmr_race_active");
    } catch {
      /* ignore */
    }
    setRaceActive(false);
  }, []);
  const [poiHarvestMode, setPoiHarvestMode] = useState(false);
  const [poiHarvestBusy, setPoiHarvestBusy] = useState(false);
  const [poiHarvestMsg, setPoiHarvestMsg] = useState<string | null>(null);
  const [poiHarvestCategories, setPoiHarvestCategories] = useState<Set<PoiCategory>>(
    () => new Set<PoiCategory>(CATEGORY_ORDER)
  );

  const [streetViewPoints, setStreetViewPoints] = useState<StreetViewAlongItem[]>([]);
  const [mapillaryPoints, setMapillaryPoints] = useState<MapillaryAlongItem[]>([]);
  const [showStreetViewLayer, setShowStreetViewLayer] = useState(true);
  const [showMapillaryLayer, setShowMapillaryLayer] = useState(true);

  const [surfaceSegmentsState, setSurfaceSegmentsState] = useState<TrackSurfaceSegmentRow[]>(
    () => initial.surfaceSegments ?? []
  );

  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [myAlongKm, setMyAlongKm] = useState<number | null>(null);
  const [myDetourM, setMyDetourM] = useState<number | null>(null);
  const [manualKm, setManualKm] = useState<number | null>(null);
  const [geoStatus, setGeoStatus] = useState<
    "idle" | "locating" | "watching" | "denied" | "unavailable"
  >("idle");
  const watchIdRef = useRef<number | null>(null);

  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [pins, setPins] = useState<{ a: number | null; b: number | null }>({
    a: null,
    b: null,
  });
  const pinAKm = pins.a;
  const pinBKm = pins.b;

  const atKm = myAlongKm ?? manualKm;
  const atKmIsManual = myAlongKm == null && manualKm != null;

  /** Centro ricerca Street View / Mapillary: segmento pin A–B, altrimenti pin, poi posizione. */
  const mediaAroundKm = useMemo(() => {
    if (pinAKm != null && pinBKm != null) return (pinAKm + pinBKm) / 2;
    if (pinAKm != null) return pinAKm;
    if (pinBKm != null) return pinBKm;
    return atKm;
  }, [pinAKm, pinBKm, atKm]);

  const mediaAroundDescription = useMemo(() => {
    if (pinAKm != null && pinBKm != null) {
      const c = (pinAKm + pinBKm) / 2;
      return `centro tra pin A e B (≈ km ${c.toFixed(1)})`;
    }
    if (pinAKm != null) return `pin A sulla traccia (km ${pinAKm.toFixed(1)})`;
    if (pinBKm != null) return `pin B sulla traccia (km ${pinBKm.toFixed(1)})`;
    if (atKm != null) return `posizione sul percorso (km ${atKm.toFixed(1)})`;
    return "metà gara — tocca la traccia per il pin A (misura) o usa GPS/km per centrare";
  }, [pinAKm, pinBKm, atKm]);

  const onPin = useCallback((km: number) => {
    setPins((prev) => {
      if (prev.a == null) return { a: km, b: null };
      if (prev.b == null) {
        if (Math.abs(km - prev.a) < 1e-6) return { a: null, b: null };
        return { a: prev.a, b: km };
      }
      return { a: km, b: null };
    });
  }, []);

  const onPinRangeFromChart = useCallback(
    (loKm: number, hiKm: number) => {
      let lo = Math.min(loKm, hiKm);
      let hi = Math.max(loKm, hiKm);
      lo = Math.max(0, lo);
      hi = Math.min(initial.length_km, hi);
      if (hi - lo < 0.05) return;
      setPins({ a: lo, b: hi });
    },
    [initial.length_km]
  );

  const resetPins = useCallback(() => setPins({ a: null, b: null }), []);

  const nudgeMeasurementTarget = useCallback(
    (deltaKm: number) => {
      setPins((prev) => {
        if (prev.a == null) return prev;
        const base = prev.b ?? prev.a;
        const nextB = Math.max(0, Math.min(initial.length_km, base + deltaKm));
        if (Math.abs(nextB - prev.a) < 1e-6) return prev;
        return { a: prev.a, b: nextB };
      });
    },
    [initial.length_km]
  );

  const onTrackKmPick = useCallback((km: number) => {
    setMapPickedKm(km);
  }, []);

  useEffect(() => {
    if (selectedPlanId && !racePlans.some((p) => p.id === selectedPlanId)) {
      setSelectedPlanId(racePlans[0]?.id ?? null);
    }
  }, [racePlans, selectedPlanId]);

  useEffect(() => {
    if (tab !== "racePlan") {
      setRacePlanMapPick(false);
    }
  }, [tab]);

  useEffect(() => {
    const key = `hmr_race_plan_overlay:${initial.id}`;
    try {
      localStorage.setItem(key, showRacePlanOverlay ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [initial.id, showRacePlanOverlay]);

  useEffect(() => {
    setSurfaceSegmentsState(initial.surfaceSegments ?? []);
  }, [initial.surfaceSegments]);

  const itemsForSelectedPlan = useMemo((): RacePlanItemRow[] => {
    if (!selectedPlanId) return [];
    return racePlans.find((p) => p.id === selectedPlanId)?.items ?? [];
  }, [racePlans, selectedPlanId]);

  const showPlanOnMap = tab === "racePlan" || showRacePlanOverlay;

  const overlayRacePlanItems = useMemo(
    () => (showPlanOnMap ? itemsForSelectedPlan : []),
    [showPlanOnMap, itemsForSelectedPlan]
  );

  const elevationRaceItems = useMemo(
    () =>
      overlayRacePlanItems.map((it) => ({
        id: it.id,
        km_start: it.km_start,
        km_end: it.km_end,
        kind: it.kind,
        title: it.title,
      })),
    [overlayRacePlanItems]
  );

  const selectedRacePlanName = useMemo(() => {
    if (!selectedPlanId) return null;
    return racePlans.find((p) => p.id === selectedPlanId)?.name ?? null;
  }, [racePlans, selectedPlanId]);

  const raceBriefPlanUpcoming = useMemo((): RacePlanItemRow[] => {
    if (!selectedPlanId || atKm == null) return [];
    const items = racePlans.find((p) => p.id === selectedPlanId)?.items ?? [];
    const eps = 0.05;
    return items
      .filter((it) => it.km_end >= atKm - eps)
      .sort((a, b) => a.km_start - b.km_start || a.id.localeCompare(b.id))
      .slice(0, 8);
  }, [selectedPlanId, atKm, racePlans]);

  const surfaceBands = useMemo(
    () =>
      surfaceSegmentsState.map((s) => ({
        km_start: s.km_start,
        km_end: s.km_end,
        surface: s.surface,
      })),
    [surfaceSegmentsState]
  );

  const surfaceKmSummary = useMemo(() => {
    const o = { asphalt: 0, gravel: 0, single: 0, unknown: 0 };
    for (const s of surfaceSegmentsState) {
      o[s.surface] += Math.max(0, s.km_end - s.km_start);
    }
    return o;
  }, [surfaceSegmentsState]);

  const hoverTerrainLabel = useMemo(() => {
    if (hoverKm == null || surfaceBands.length === 0) return null;
    const k = surfaceKindAtKm(surfaceBands, hoverKm);
    return k ? formatTerrainIt(k) : null;
  }, [hoverKm, surfaceBands]);

  const startGeolocation = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoStatus("unavailable");
      return;
    }
    if (watchIdRef.current != null) return;
    setGeoStatus("locating");
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setMyPosition({ lat: latitude, lng: longitude });
        const proj = projectLngLatToTrack(initial.coords, longitude, latitude);
        if (proj) {
          setMyAlongKm(proj.alongKm);
          setMyDetourM(proj.distKm * 1000);
        }
        setGeoStatus("watching");
      },
      (err) => {
        console.warn("geolocation", err);
        setGeoStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 }
    );
    watchIdRef.current = id;
  }, [initial.coords]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const onToggleCategory = (c: PoiCategory) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const [selectedPoi, setSelectedPoi] = useState<PoiRow | null>(null);

  const elevProfileScaleOpts = useMemo(
    () => ({
      profileGainScale: initial.elev_profile_gain_scale,
      profileLossScale: initial.elev_profile_loss_scale,
    }),
    [initial.elev_profile_gain_scale, initial.elev_profile_loss_scale]
  );

  const measurement = useMemo(() => {
    if (pinAKm == null) return null;
    const other = pinBKm ?? hoverKm;
    if (other == null) {
      const a = coordAtKm(initial.coords, pinAKm);
      return {
        aKm: pinAKm,
        bKm: null as number | null,
        bIsCursor: false,
        distKm: 0,
        gainM: 0,
        lossM: 0,
        elevA: a?.elev ?? null,
        elevB: null as number | null,
      };
    }
    const m = measureBetween(initial.coords, pinAKm, other, elevProfileScaleOpts);
    return {
      aKm: pinAKm,
      bKm: other,
      bIsCursor: pinBKm == null,
      distKm: m.distKm,
      gainM: m.gainM,
      lossM: m.lossM,
      elevA: m.elevA,
      elevB: m.elevB,
    };
  }, [pinAKm, pinBKm, hoverKm, initial.coords, elevProfileScaleOpts]);

  const hoverElev = useMemo(() => {
    if (hoverKm == null) return null;
    return coordAtKm(initial.coords, hoverKm)?.elev ?? null;
  }, [hoverKm, initial.coords]);

  const tabButtons = useMemo(
    () =>
      [
        { id: "dashboard" as Tab, label: "Qui e ora" },
        { id: "race" as Tab, label: "Gara" },
        { id: "roadbook" as Tab, label: "Roadbook" },
        { id: "list" as Tab, label: `Lista (${pois.length})` },
        { id: "checkpoints" as Tab, label: "Checkpoint" },
        { id: "racePlan" as Tab, label: "Piano gara" },
      ] as const,
    [pois.length]
  );

  const openAddSheet = useCallback(() => {
    setAddPoiMapPick(false);
    setShowAddSheet(true);
  }, []);

  const closeAddSheet = useCallback(() => {
    setShowAddSheet(false);
    setAddPoiMapPick(false);
  }, []);

  const requestAddPoiMapPick = useCallback(() => {
    setAddPoiMapPick(true);
    setPoiHarvestMode(false);
    setRacePlanMapPick(false);
  }, []);

  const onAddPoiMapClick = useCallback((lat: number, lng: number) => {
    setAddPoiPickedLatLng({ lat, lng });
    setAddPoiMapPick(false);
  }, []);

  const clearAddPoiPick = useCallback(() => setAddPoiPickedLatLng(null), []);

  const onPoiAdded = useCallback((poi: PoiRow) => {
    setPois((prev) =>
      [...prev, poi].sort((a, b) => a.along_km - b.along_km)
    );
    setVisibleCategories((prev) => {
      if (prev.has(poi.category)) return prev;
      const next = new Set(prev);
      next.add(poi.category);
      return next;
    });
  }, []);

  const onPoiDeleted = useCallback((poiId: string) => {
    setPois((prev) => prev.filter((p) => p.id !== poiId));
  }, []);

  const onTogglePoiHarvestCategory = useCallback((c: PoiCategory) => {
    setPoiHarvestCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }, []);

  const onPoiHarvestClick = useCallback(
    async (lat: number, lng: number) => {
      if (poiHarvestCategories.size === 0) {
        setPoiHarvestMsg("Seleziona almeno una categoria da cercare.");
        return;
      }
      setPoiHarvestBusy(true);
      setPoiHarvestMsg(null);
      try {
        const r = await fetch(
          `/api/track/${encodeURIComponent(initial.id)}/pois/harvest`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat,
              lng,
              radiusM: 2500,
              categories: Array.from(poiHarvestCategories),
            }),
          }
        );
        const j = (await r.json()) as {
          error?: string;
          inserted?: number;
          skippedDetour?: number;
          skippedUnclassified?: number;
          skippedCategoryFilter?: number;
          osmReturned?: number;
          pois?: PoiRow[];
          fromOverpassCache?: boolean;
        };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        const newPois = j.pois ?? [];
        if (newPois.length > 0) {
          setPois((prev) => {
            const ids = new Set(prev.map((p) => p.id));
            const add = newPois.filter((p) => !ids.has(p.id));
            return [...prev, ...add].sort((a, b) => a.along_km - b.along_km);
          });
        }
        const su = j.skippedUnclassified ?? 0;
        const sf = j.skippedCategoryFilter ?? 0;
        const cacheHint = j.fromOverpassCache ? " · cache Overpass" : "";
        setPoiHarvestMsg(
          `OSM ${j.osmReturned ?? 0} oggetti · +${j.inserted ?? 0} in elenco · oltre soglia import ${j.skippedDetour ?? 0}` +
            (su > 0 ? ` · tag non mappati ${su}` : "") +
            (sf > 0 ? ` · fuori filtro ${sf}` : "") +
            cacheHint
        );
      } catch (e) {
        setPoiHarvestMsg((e as Error).message);
      } finally {
        setPoiHarvestBusy(false);
      }
    },
    [initial.id, poiHarvestCategories]
  );

  const togglePoiHarvestMode = useCallback(() => {
    setPoiHarvestMode((v) => {
      const next = !v;
      if (next) {
        setRacePlanMapPick(false);
        setPoiHarvestMsg(null);
      } else {
        setPoiHarvestMsg(null);
      }
      return next;
    });
  }, []);

  const chartZoomKm = useMemo(() => {
    if (pinAKm == null || pinBKm == null)
      return { lo: null as number | null, hi: null as number | null };
    return { lo: Math.min(pinAKm, pinBKm), hi: Math.max(pinAKm, pinBKm) };
  }, [pinAKm, pinBKm]);

  const wideRail = useSyncExternalStore(subscribeHmrWideRail, getHmrWideRailSnapshot, () => false);

  const mapChromeProps = {
    trackName: initial.name,
    lengthKm: initial.length_km,
    elevGainM: initial.elev_gain_m,
    elevLossM: initial.elev_loss_m,
    sessionEmail,
    surfaceKm: surfaceKmSummary,
    showSections,
    onToggleSections: () => setShowSections((v) => !v),
    showResupply,
    onToggleResupply: () => setShowResupply((v) => !v),
    onOpenAddSheet: openAddSheet,
    poiHarvestMode,
    poiHarvestBusy,
    onTogglePoiHarvest: togglePoiHarvestMode,
    visibleCategories,
    onToggleCategory,
  };

  return (
    <main
      className="relative w-full overflow-hidden"
      style={{ height: "100dvh" }}
    >
      <div className="absolute inset-0" style={{ height: "100dvh" }}>
        <MapView
          coords={initial.coords}
          bbox={initial.bbox}
          checkpoints={initial.checkpoints}
          resupply={initial.resupply}
          sections={initial.sections}
          pois={pois}
          visibleCategories={visibleCategories}
          showResupply={showResupply}
          showSections={showSections}
          myAlongKm={atKm}
          myPosition={myPosition}
          hoverKm={hoverKm}
          pinAKm={pinAKm}
          pinBKm={pinBKm}
          onHoverKm={setHoverKm}
          onPin={onPin}
          onSelectPoi={(p) => setSelectedPoi(p)}
          racePlanItems={overlayRacePlanItems}
          trackClickMode={
            addPoiMapPick
              ? "addPoi"
              : poiHarvestMode
                ? "poiHarvest"
                : tab === "racePlan" && racePlanMapPick
                  ? "racePlan"
                  : "measure"
          }
          onTrackKmPick={onTrackKmPick}
          onPoiHarvestClick={poiHarvestMode ? onPoiHarvestClick : undefined}
          onAddPoiMapClick={addPoiMapPick ? onAddPoiMapClick : undefined}
          surfaceSegments={surfaceBands}
          streetViewPoints={streetViewPoints}
          mapillaryPoints={mapillaryPoints}
          showStreetViewLayer={showStreetViewLayer}
          showMapillaryLayer={showMapillaryLayer}
        />
      </div>

      {!wideRail && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 px-3 pt-[calc(var(--safe-top)+0.5rem)]">
          <MapChromeControls variant="overlay" {...mapChromeProps} />
        </header>
      )}
      {poiHarvestMode && (
        <div
          className={`pointer-events-none absolute left-3 right-3 z-30 flex justify-center ${
            wideRail
              ? "top-[calc(var(--safe-top)+0.65rem)]"
              : "top-[7.5rem]"
          }`}
        >
          <div className="pointer-events-auto max-w-lg rounded-none border border-emerald-500/40 bg-[color:var(--hmr-panel-bg)] px-3 py-2 text-center text-[11px] font-semibold leading-snug tracking-tight text-[color:var(--hmr-muted)] shadow-lg">
            <span className="font-medium text-emerald-200/95">Cerca POI OSM</span>
            {" — "}
            Scegli le categorie, poi clicca sulla mappa (cerchio fino ~2,5 km verso OSM; in DB fino ~15 km dal GPX). In lista alza «detour» se non vedi i nuovi POI.
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[10px]">
              <button
                type="button"
                className="hmr-btn hmr-tap rounded-none px-2 py-1"
                onClick={() =>
                  setPoiHarvestCategories(
                    new Set<PoiCategory>(["shop", "restaurant", "lodging"])
                  )
                }
              >
                Spesa + cibo + letto
              </button>
              <button
                type="button"
                className="hmr-btn hmr-tap rounded-none px-2 py-1"
                onClick={() => setPoiHarvestCategories(new Set(CATEGORY_ORDER))}
              >
                Tutte
              </button>
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-left text-[10px]">
              {CATEGORY_ORDER.map((cat) => (
                <label key={`harvest-${cat}`} className="flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    checked={poiHarvestCategories.has(cat)}
                    onChange={() => onTogglePoiHarvestCategory(cat)}
                  />
                  <span>{labelForCategory(cat)}</span>
                </label>
              ))}
            </div>
            {poiHarvestMsg && (
              <span className="mt-1 block text-[color:var(--hmr-faint)]">{poiHarvestMsg}</span>
            )}
          </div>
        </div>
      )}

      <OfflineStatus trackId={initial.id} bbox={initial.bbox} />

      {measurement && (
        <MeasurementOverlay
          measurement={measurement}
          trackLengthKm={initial.length_km}
          hoverKm={hoverKm}
          hoverElev={hoverElev}
          onReset={resetPins}
          onNudgeTarget={nudgeMeasurementTarget}
          hoverTerrainLabel={hoverTerrainLabel}
          hasSurfaceData={surfaceBands.length > 0}
          dockRight={wideRail}
        />
      )}

      <div
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-[18] border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)]/97 shadow-[0_-6px_28px_rgba(0,0,0,0.42)]"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        <div className="mx-auto flex h-[var(--hmr-profile-strip)] min-h-0 w-full max-w-[100vw] px-0.5 pt-0.5">
          <ElevationChart
            coords={initial.coords}
            sections={initial.sections}
            checkpoints={initial.checkpoints}
            atKm={atKm}
            hoverKm={hoverKm}
            pinAKm={pinAKm}
            pinBKm={pinBKm}
            onHoverKm={setHoverKm}
            onPinKm={onPin}
            onPinRange={onPinRangeFromChart}
            raceItems={elevationRaceItems}
            surfaceBands={surfaceBands}
            hoverTerrainLabel={hoverTerrainLabel}
            elevProfileGainScale={initial.elev_profile_gain_scale}
            elevProfileLossScale={initial.elev_profile_loss_scale}
            zoomKmLo={chartZoomKm.lo}
            zoomKmHi={chartZoomKm.hi}
            wrapperClassName="!rounded-none !border-0 !bg-transparent !shadow-none h-full min-h-0 w-full min-w-0"
          />
        </div>
      </div>

      <BottomSheet
        snap={snap}
        onSnapChange={setSnap}
        railTop={wideRail ? <MapChromeControls variant="rail" {...mapChromeProps} /> : undefined}
        reserveProfileStrip={!wideRail}
        header={
          <div className="flex w-full min-w-0 items-center gap-0.5">
            <nav className="flex min-w-0 flex-1 flex-wrap gap-0.5">
              {tabButtons.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTab(t.id);
                    if (snap === "peek") setSnap("half");
                  }}
                  className={`hmr-chip !min-h-0 !min-w-0 touch-manipulation px-2 py-0.5 text-[9px] font-medium leading-tight ${
                    tab === t.id ? "hmr-chip-on" : "hmr-chip-off"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <button
              type="button"
              title={
                selectedPlanId
                  ? showRacePlanOverlay
                    ? "Piano visibile su mappa e profilo anche fuori dal tab Piano gara"
                    : "Mostra il piano selezionato su mappa e profilo negli altri tab"
                  : "Seleziona un piano nel tab Piano gara"
              }
              disabled={!selectedPlanId}
              onClick={() => setShowRacePlanOverlay((v) => !v)}
              className={`hmr-chip !min-h-0 shrink-0 touch-manipulation px-2 py-0.5 text-[9px] font-medium leading-tight ${
                !selectedPlanId
                  ? "hmr-chip-off opacity-50"
                  : showRacePlanOverlay
                    ? "hmr-chip-on"
                    : "hmr-chip-off"
              }`}
            >
              Mappa piano
            </button>
            <button
              type="button"
              onClick={() => setSnap(snap === "full" ? "half" : "full")}
              className="hmr-btn !min-h-0 !min-w-0 shrink-0 touch-manipulation px-2 py-0.5 text-[9px] leading-none"
            >
              {snap === "full" ? "↓" : "↑"}
            </button>
          </div>
        }
      >
        {tab === "dashboard" && (
          <>
            <AlongMediaControls
              trackId={initial.id}
              aroundKm={mediaAroundKm}
              aroundDescription={mediaAroundDescription}
              lengthKm={initial.length_km}
              streetViewPoints={streetViewPoints}
              mapillaryPoints={mapillaryPoints}
              onStreetViewLoaded={setStreetViewPoints}
              onMapillaryLoaded={setMapillaryPoints}
              showStreetViewLayer={showStreetViewLayer}
              showMapillaryLayer={showMapillaryLayer}
              onShowStreetViewChange={setShowStreetViewLayer}
              onShowMapillaryChange={setShowMapillaryLayer}
            />
            <DashboardHere
              trackId={initial.id}
              lengthKm={initial.length_km}
              atKm={atKm}
              atKmIsManual={atKmIsManual}
              onManualKmChange={(km) => {
                setManualKm(km);
                if (myAlongKm != null) {
                  if (watchIdRef.current != null) {
                    navigator.geolocation.clearWatch(watchIdRef.current);
                    watchIdRef.current = null;
                  }
                  setMyAlongKm(null);
                  setMyPosition(null);
                  setMyDetourM(null);
                  setGeoStatus("idle");
                }
              }}
              onRequestGeolocation={startGeolocation}
              geolocationStatus={geoStatus}
              myPositionDetourM={myDetourM}
              surfaceKm={surfaceKmSummary}
            />
          </>
        )}
        {tab === "list" && (
          <PoiList
            pois={pois}
            resupply={initial.resupply}
            atKm={atKm}
            lengthKm={initial.length_km}
            visibleCategories={visibleCategories}
            onToggleCategory={onToggleCategory}
            showResupply={showResupply}
            onToggleResupply={() => setShowResupply((v) => !v)}
            onSelectPoi={(p) => setSelectedPoi(p)}
          />
        )}
        {tab === "checkpoints" && (
          <CheckpointsPanel
            checkpoints={initial.checkpoints}
            coords={initial.coords}
            atKm={atKm}
          />
        )}
        {tab === "roadbook" && (
          <RoadbookPanel trackId={initial.id} lengthKm={initial.length_km} />
        )}
        {tab === "race" && (
          <RaceBriefPanel
            trackId={initial.id}
            lengthKm={initial.length_km}
            atKm={atKm}
            raceStarted={raceActive}
            onStartRace={startRace}
            onEndRace={endRace}
            racePlanName={selectedRacePlanName}
            racePlanUpcomingItems={raceBriefPlanUpcoming}
          />
        )}
        {tab === "racePlan" && (
          <RacePlanPanel
            trackId={initial.id}
            lengthKm={initial.length_km}
            coords={initial.coords}
            racePlans={racePlans}
            onRacePlansChange={setRacePlans}
            selectedPlanId={selectedPlanId}
            onSelectPlanId={setSelectedPlanId}
            mapPickedKm={mapPickedKm}
            onClearMapPickedKm={() => setMapPickedKm(null)}
            mapPickActive={racePlanMapPick}
            onMapPickActiveChange={setRacePlanMapPick}
            pinAKm={pinAKm}
            pinBKm={pinBKm}
          />
        )}
      </BottomSheet>

      {selectedPoi && (
        <PoiModal
          poi={selectedPoi}
          trackId={initial.id}
          onClose={() => setSelectedPoi(null)}
          onDeleted={(id) => {
            onPoiDeleted(id);
            setSelectedPoi(null);
          }}
        />
      )}

      {showAddSheet && (
        <AddPoiSheet
          trackId={initial.id}
          coords={initial.coords}
          onClose={closeAddSheet}
          onAdded={onPoiAdded}
          mapPickActive={addPoiMapPick}
          onRequestMapPick={requestAddPoiMapPick}
          pickedLngLat={addPoiPickedLatLng}
          onClearPick={clearAddPoiPick}
        />
      )}
    </main>
  );
}

type MeasurementInfo = {
  aKm: number;
  bKm: number | null;
  bIsCursor: boolean;
  distKm: number;
  gainM: number;
  lossM: number;
  elevA: number | null;
  elevB: number | null;
};

function MeasurementOverlay({
  measurement,
  trackLengthKm,
  hoverKm,
  hoverElev,
  onReset,
  onNudgeTarget,
  hoverTerrainLabel,
  hasSurfaceData,
  dockRight,
}: {
  measurement: MeasurementInfo;
  trackLengthKm: number;
  hoverKm: number | null;
  hoverElev: number | null;
  onReset: () => void;
  onNudgeTarget: (deltaKm: number) => void;
  hoverTerrainLabel: string | null;
  hasSurfaceData: boolean;
  dockRight: boolean;
}) {
  const deltaElev =
    measurement.elevA != null && measurement.elevB != null
      ? measurement.elevB - measurement.elevA
      : null;
  const bLabel = measurement.bKm == null
    ? "—"
    : measurement.bIsCursor
      ? `cursore · km ${measurement.bKm.toFixed(1)}`
      : `km ${measurement.bKm.toFixed(1)}`;
  const measurePadTop = dockRight
    ? "pt-[calc(var(--safe-top)+0.5rem)]"
    : "pt-[6.5rem] sm:pt-[5.5rem]";
  return (
    <div
      className={`pointer-events-none absolute top-[calc(var(--safe-top)+0.5rem)] z-30 flex max-w-[min(92vw,22rem)] flex-col gap-2 ${dockRight ? "right-3 left-auto items-end" : "left-3 items-stretch"} ${measurePadTop}`}
    >
      <div
        className={`pointer-events-auto hmr-panel px-3 py-2 text-xs shadow-lg ${dockRight ? "text-right" : ""}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--hmr-muted)]">
            Misura traccia
          </span>
          <button
            type="button"
            onClick={onReset}
            className="hmr-btn hmr-tap text-[10px]"
          >
            Reset pin
          </button>
        </div>
        <p className="mb-2 text-[9px] leading-snug text-[color:var(--hmr-faint)]">
          Profilo in basso: trascina sull&apos;altimetria per impostare l&apos;arco A–B; tocca per pin
          singoli.
        </p>
        {measurement.bKm == null && (
          <p className="mb-2 text-[10px] text-[color:var(--hmr-muted)]">
            Passa il cursore sulla traccia o sul grafico, poi clicca per piazzare B (oppure trascina sul
            profilo).
          </p>
        )}
        <div className="border-t border-[color:var(--hmr-border)]/60 pt-2">
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
            <span className="text-[color:var(--hmr-muted)]">A</span>
            <span>
              km {measurement.aKm.toFixed(1)}
              {measurement.elevA != null && (
                <span className="text-[color:var(--hmr-muted)]"> · {Math.round(measurement.elevA)} m</span>
              )}
            </span>
            <span className="text-[color:var(--hmr-muted)]">B</span>
            <span>
              {bLabel}
              {measurement.elevB != null && (
                <span className="text-[color:var(--hmr-muted)]"> · {Math.round(measurement.elevB)} m</span>
              )}
            </span>
          </div>
        </div>
        {measurement.bKm != null && (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <MetricCell label="Δkm" value={`${measurement.distKm.toFixed(2)}`} />
              <MetricCell label="D+" value={`${Math.round(measurement.gainM)} m`} />
              <MetricCell label="D-" value={`${Math.round(measurement.lossM)} m`} />
              <MetricCell
                label="Δ quota"
                value={
                  deltaElev != null ? `${deltaElev > 0 ? "+" : ""}${Math.round(deltaElev)} m` : "—"
                }
              />
            </div>
            <div className="mt-2 border-t border-[color:var(--hmr-border)]/60 pt-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--hmr-muted)]">
                Dislivello (D+)
              </div>
              <div
                className="font-semibold tabular-nums leading-none text-[color:var(--hmr-text)]"
                style={{ fontSize: "clamp(1.2rem, 5.5vw, 1.65rem)" }}
              >
                +{Math.round(measurement.gainM)} m
              </div>
            </div>
          </>
        )}
        {hoverKm != null && (
          <p className="mt-2 border-t border-[color:var(--hmr-border)]/60 pt-2 text-[10px] text-[color:var(--hmr-muted)]">
            Cursore: km {hoverKm.toFixed(1)}
            {hoverElev != null ? ` · ${Math.round(hoverElev)} m` : ""}
            {hoverTerrainLabel && (
              <span className="block text-[color:var(--hmr-accent)]">Terreno (OSM): {hoverTerrainLabel}</span>
            )}
            {!hoverTerrainLabel && hasSurfaceData && (
              <span className="block text-[color:var(--hmr-faint)]">Terreno: fuori dati OSM</span>
            )}
          </p>
        )}
        <div className="mt-2 border-t border-[color:var(--hmr-border)]/60 pt-2 md:hidden">
          <p className="mb-1 text-[10px] text-[color:var(--hmr-muted)]">Parziale rapido (mobile)</p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { label: "+5 km", deltaKm: 5 },
                { label: "+10 km", deltaKm: 10 },
                { label: "+20 km", deltaKm: 20 },
              ] as const
            ).map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onNudgeTarget(item.deltaKm)}
                className="hmr-btn hmr-tap rounded-none px-2 py-1 text-[10px]"
                disabled={measurement.aKm >= trackLengthKm - 0.05}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-none bg-black/20 px-1 py-1">
      <span className="text-[9px] uppercase tracking-wide text-[color:var(--hmr-faint)]">{label}</span>
      <span className="text-[11px] font-medium text-[color:var(--hmr-text)]">{value}</span>
    </div>
  );
}

function PoiModal({
  poi,
  trackId,
  onClose,
  onDeleted,
}: {
  poi: PoiRow;
  trackId: string;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}) {
  const isUser = poi.osm_type === "user";
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!isUser || !onDeleted) return;
    if (typeof window !== "undefined" && !window.confirm("Eliminare questo POI?")) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/track/${trackId}/pois/custom?poiId=${encodeURIComponent(poi.id)}`,
        { method: "DELETE" }
      );
      const data = (await res.json()) as { deleted?: number; error?: string };
      if (!res.ok) {
        setError(data.error ?? "errore");
        setDeleting(false);
        return;
      }
      onDeleted(poi.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  const gmapsHref = isUser && poi.website
    ? poi.website
    : `https://maps.google.com/?q=${poi.lat},${poi.lng}`;

  return (
    <div
      className="absolute inset-0 z-40 flex items-end justify-center bg-black/60 pb-[calc(var(--safe-bottom)+1rem)] sm:items-center"
      onClick={onClose}
    >
      <div
        className="hmr-panel m-3 w-full max-w-md overflow-hidden p-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h4 className="text-base font-semibold">
              {poi.name ?? poi.sub_kind ?? "POI"}
              {isUser && (
                <span className="ml-2 rounded-none border border-[color:var(--hmr-accent)]/60 bg-[color:var(--hmr-accent-dim)] px-2 py-0.5 text-[10px] font-semibold tracking-tight text-[color:var(--hmr-accent)]">
                  personalizzato
                </span>
              )}
            </h4>
            <p className="text-xs text-[color:var(--hmr-muted)]">
              {poi.category} · km {poi.along_km.toFixed(1)} · +{poi.detour_m} m dalla traccia
            </p>
          </div>
          <button type="button" onClick={onClose} className="hmr-btn hmr-tap text-xs">
            Chiudi
          </button>
        </div>
        {poi.description && <p className="mb-2 text-xs text-[color:var(--hmr-muted)]">{poi.description}</p>}
        {poi.opening_hours && (
          <p className="mb-2 text-xs">
            <span className="text-[color:var(--hmr-muted)]">Orari:</span> {poi.opening_hours}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <a
            href={gmapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hmr-btn hmr-btn-accent hmr-tap text-xs"
          >
            Apri in Google Maps
          </a>
          {poi.phone && (
            <a href={`tel:${poi.phone}`} className="hmr-btn hmr-tap text-xs">
              {poi.phone}
            </a>
          )}
          {poi.website && !isUser && (
            <a
              href={poi.website}
              target="_blank"
              rel="noopener noreferrer"
              className="hmr-btn hmr-tap text-xs"
            >
              Sito
            </a>
          )}
          {isUser && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="hmr-btn hmr-tap ml-auto text-xs"
              style={{
                borderColor: "rgba(248,113,113,0.5)",
                color: "var(--hmr-danger)",
              }}
            >
              {deleting ? "Elimino…" : "Elimina"}
            </button>
          )}
        </div>
        {error && (
          <p className="mt-2 text-xs text-[color:var(--hmr-danger)]">{error}</p>
        )}
      </div>
    </div>
  );
}
