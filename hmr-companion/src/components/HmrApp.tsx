"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type {
  CheckpointRow,
  CourseBridgeRow,
  NotableSectionRow,
  PoiCategory,
  PoiNoteWithPhotos,
  PoiRow,
  RacePlanItemRow,
  RacePlanWithItems,
  ResupplyRow,
  TrackSurfaceSegmentRow,
} from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import type { StreetViewAlongItem } from "@/lib/along-media-types";
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
import StreetViewMapChrome from "./StreetViewMapChrome";
import WindyOverlay, { type WindyMode } from "./WindyOverlay";
import OfflineStatus from "./OfflineStatus";
import RoadbookPanel from "./RoadbookPanel";
import RaceBriefPanel from "./RaceBriefPanel";
import NextPoiList from "./NextPoiList";
import PoiEditSheet from "./PoiEditSheet";
import FieldPoiSheet from "./FieldPoiSheet";
import FieldAddPoiSheet from "./FieldAddPoiSheet";
import { categoriesForRacePreset, type RacePoiFilterPreset } from "@/lib/poi-race-filter";

export type HmrTab = "dashboard" | "nextPoi" | "race" | "roadbook" | "list" | "checkpoints" | "racePlan";
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
  bridges: CourseBridgeRow[];
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
  streetViewTrackId,
  streetViewAroundKm,
  streetViewPoints,
  onStreetViewLoaded,
  showStreetViewLayer,
  onShowStreetViewChange,
  windyActive,
  onWindyToggle,
  layout = "full",
  onExitRaceLayout,
  raceFilterRow,
  fieldProgramMode = false,
  onToggleFieldProgram,
}: {
  variant: "overlay" | "rail";
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
  streetViewTrackId: string;
  streetViewAroundKm: number | null;
  streetViewPoints: StreetViewAlongItem[];
  onStreetViewLoaded: (items: StreetViewAlongItem[]) => void;
  showStreetViewLayer: boolean;
  onShowStreetViewChange: (v: boolean) => void;
  windyActive: boolean;
  onWindyToggle: () => void;
  layout?: "full" | "race";
  onExitRaceLayout?: () => void;
  raceFilterRow?: ReactNode;
  fieldProgramMode?: boolean;
  onToggleFieldProgram?: () => void;
}) {
  const popMenuLeft =
    variant === "rail" ? "left-0 right-auto" : "left-0 right-auto max-sm:max-w-[min(11rem,calc(100vw-1.5rem))]";
  const popMenuRight = variant === "rail" ? "right-0 left-auto" : "right-0 left-auto max-sm:max-w-[min(14rem,calc(100vw-1.5rem))]";

  return (
    <>
      <div
        className={`pointer-events-auto flex w-full min-w-0 max-w-full flex-wrap items-start ${variant === "rail" ? "gap-1" : "gap-1 sm:gap-1.5"}`}
      >
            {layout === "race" ? (
              <>
                <button
                  type="button"
                  onClick={onWindyToggle}
                  className={`hmr-chip max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px] ${windyActive ? "hmr-chip-on" : "hmr-chip-off"}`}
                  aria-pressed={windyActive}
                  title="Mappa meteo Windy (satellite / pioggia GFS)"
                >
                  Meteo
                </button>
                <button
                  type="button"
                  onClick={onToggleFieldProgram}
                  className={`hmr-chip max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px] ${
                    fieldProgramMode ? "hmr-chip-on" : "hmr-chip-off"
                  }`}
                  aria-pressed={fieldProgramMode}
                  title="Tocca POI per confermare arrivo, commento e foto; tocca mappa per nuovo POI"
                >
                  Campo
                </button>
                <button
                  type="button"
                  onClick={onExitRaceLayout}
                  className="hmr-chip hmr-chip-off max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px]"
                >
                  Modalità Planner
                </button>
                {raceFilterRow != null && (
                  <div className="flex min-w-0 max-w-full flex-[1_1_100%] flex-wrap gap-1">
                    {raceFilterRow}
                  </div>
                )}
              </>
            ) : (
              <>
            <button
              type="button"
              onClick={onToggleSections}
              className={`hmr-chip max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px] ${showSections ? "hmr-chip-on" : "hmr-chip-off"}`}
            >
              Toughest
            </button>
            <button
              type="button"
              onClick={onToggleResupply}
              className={`hmr-chip max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px] ${showResupply ? "hmr-chip-on" : "hmr-chip-off"}`}
            >
              Resupply
            </button>
            <button
              type="button"
              onClick={onOpenAddSheet}
              className="hmr-chip hmr-chip-off max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px]"
              aria-label="Aggiungi POI da link Google Maps"
            >
              Aggiungi
            </button>
            <button
              type="button"
              onClick={onTogglePoiHarvest}
              disabled={poiHarvestBusy}
              className={`hmr-chip max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px] ${poiHarvestMode ? "hmr-chip-on" : "hmr-chip-off"}`}
              aria-pressed={poiHarvestMode}
              title="Clic sulla mappa: cerca su OpenStreetMap nel raggio (~450 m) le categorie selezionate nel pannello verde"
            >
              {poiHarvestBusy ? "OSM…" : "OSM qui"}
            </button>
            <button
              type="button"
              onClick={onWindyToggle}
              className={`hmr-chip max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px] ${windyActive ? "hmr-chip-on" : "hmr-chip-off"}`}
              aria-pressed={windyActive}
              title="Mappa meteo Windy (satellite / pioggia GFS)"
            >
              Meteo
            </button>
            <StreetViewMapChrome
              trackId={streetViewTrackId}
              aroundKm={streetViewAroundKm}
              streetViewPoints={streetViewPoints}
              onStreetViewLoaded={onStreetViewLoaded}
              showStreetViewLayer={showStreetViewLayer}
              onShowStreetViewChange={onShowStreetViewChange}
            />
            <details className="relative">
              <summary className="hmr-chip hmr-chip-off max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] cursor-pointer list-none select-none sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px]">
                Filtri POI
              </summary>
              <div
                className={`hmr-panel absolute ${popMenuLeft} z-40 mt-2 w-44 max-h-[min(70dvh,20rem)] overflow-y-auto rounded-none border border-[color:var(--hmr-border)]/80 p-2 text-xs font-semibold tracking-tight shadow-xl`}
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
              </>
            )}
            <div
              className={`flex shrink-0 flex-wrap items-center gap-1 ${variant === "rail" ? "" : "max-sm:basis-full max-sm:justify-end sm:ml-auto"}`}
            >
              <Link
                href="/"
                className="hmr-chip hmr-chip-off max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px]"
                title="Torna alla selezione gare"
              >
                Gare
              </Link>
              <span className="max-w-[7rem] truncate text-[8px] text-[color:var(--hmr-faint)] sm:max-w-[11rem] sm:text-[9px]">
                {sessionEmail}
              </span>
              <details className="relative">
                <summary className="hmr-chip hmr-chip-off max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] cursor-pointer list-none select-none sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px]">
                  Info
                </summary>
                <div
                  className={`hmr-panel absolute ${popMenuRight} z-40 mt-2 min-w-[12rem] rounded-none border border-[color:var(--hmr-border)]/80 p-2 text-left text-[10px] font-semibold tracking-tight shadow-xl`}
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
              <button
                type="button"
                onClick={() => {
                  void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
                    window.location.reload();
                  });
                }}
                className="hmr-chip hmr-chip-off max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px]"
              >
                Esci
              </button>
            </div>
          </div>
    </>
  );
}

function normalizePoiRow(p: PoiRow): PoiRow {
  return {
    ...p,
    race_visible: p.race_visible === 0 ? 0 : 1,
  };
}

export default function HmrApp({
  initial,
  sessionEmail,
  initialTab = "dashboard",
  initialRaceActive = false,
}: {
  initial: TrackPayload;
  sessionEmail: string;
  initialTab?: Tab;
  /** Es. `/race`: attiva subito modalità Race su mobile stretto. */
  initialRaceActive?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [visibleCategories, setVisibleCategories] = useState<Set<PoiCategory>>(
    () => new Set<PoiCategory>(CATEGORY_ORDER)
  );
  const [racePoiFilter, setRacePoiFilter] = useState<RacePoiFilterPreset>("all");
  const [racePreviewOpen, setRacePreviewOpen] = useState(false);
  const [poiEditTarget, setPoiEditTarget] = useState<PoiRow | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [showResupply, setShowResupply] = useState(true);
  const [showSections, setShowSections] = useState(true);
  const [pois, setPois] = useState<PoiRow[]>(() => initial.pois.map(normalizePoiRow));
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
  const [fieldProgramMode, setFieldProgramMode] = useState(true);
  const [fieldNotes, setFieldNotes] = useState<Map<string, PoiNoteWithPhotos>>(() => new Map());
  const [fieldPoiTarget, setFieldPoiTarget] = useState<PoiRow | null>(null);
  const [fieldAddLatLng, setFieldAddLatLng] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    try {
      setRaceActive(localStorage.getItem("hmr_race_active") === "1");
      const fp = localStorage.getItem("hmr_field_program");
      if (fp === "0") setFieldProgramMode(false);
      else if (fp === "1") setFieldProgramMode(true);
    } catch {
      setRaceActive(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/track/${initial.id}/field-notes`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { notes?: PoiNoteWithPhotos[] };
        if (cancelled || !data.notes) return;
        const map = new Map<string, PoiNoteWithPhotos>();
        for (const n of data.notes) map.set(n.poi_id, n);
        setFieldNotes(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial.id]);

  const toggleFieldProgram = useCallback(() => {
    setFieldProgramMode((v) => {
      const next = !v;
      try {
        localStorage.setItem("hmr_field_program", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
    setFieldAddLatLng(null);
    setFieldPoiTarget(null);
  }, []);

  const visitedPoiIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [poiId, note] of fieldNotes) {
      if (note.status === "visited") ids.add(poiId);
    }
    return ids;
  }, [fieldNotes]);

  const onFieldNoteSaved = useCallback((note: PoiNoteWithPhotos) => {
    setFieldNotes((prev) => {
      const next = new Map(prev);
      next.set(note.poi_id, note);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!initialRaceActive) return;
    try {
      localStorage.setItem("hmr_race_active", "1");
    } catch {
      /* ignore */
    }
    setRaceActive(true);
  }, [initialRaceActive]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const fn = () => setIsNarrow(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
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
  const [poiHarvestBannerExpanded, setPoiHarvestBannerExpanded] = useState(true);
  const [poiHarvestBusy, setPoiHarvestBusy] = useState(false);
  const [poiHarvestMsg, setPoiHarvestMsg] = useState<string | null>(null);
  const [poiHarvestCategories, setPoiHarvestCategories] = useState<Set<PoiCategory>>(
    () => new Set<PoiCategory>(CATEGORY_ORDER)
  );

  const [streetViewPoints, setStreetViewPoints] = useState<StreetViewAlongItem[]>([]);
  const [showStreetViewLayer, setShowStreetViewLayer] = useState(true);
  const [windyActive, setWindyActive] = useState(false);
  const [windyMode, setWindyMode] = useState<WindyMode>("radar");
  const [mapViewport, setMapViewport] = useState<{
    lat: number;
    lng: number;
    zoom: number;
  } | null>(null);
  const [flyToKmRange, setFlyToKmRange] = useState<{ lo: number; hi: number } | null>(null);

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

  const isRaceLayout = raceActive && isNarrow;

  const categoriesForMap = useMemo(
    () => (isRaceLayout ? categoriesForRacePreset(racePoiFilter) : visibleCategories),
    [isRaceLayout, racePoiFilter, visibleCategories]
  );

  const mapPois = useMemo(() => {
    if (!isRaceLayout) return pois;
    return pois.filter((p) => p.race_visible !== 0);
  }, [isRaceLayout, pois]);

  useEffect(() => {
    if (!isRaceLayout) return;
    if (tab !== "dashboard" && tab !== "nextPoi") {
      setTab("dashboard");
    }
  }, [isRaceLayout, tab]);

  /** Centro ricerca Street View: segmento pin A–B, altrimenti pin, poi posizione. */
  const mediaAroundKm = useMemo(() => {
    if (pinAKm != null && pinBKm != null) return (pinAKm + pinBKm) / 2;
    if (pinAKm != null) return pinAKm;
    if (pinBKm != null) return pinBKm;
    return atKm;
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

  const handleMapPin = useCallback(
    (km: number) => {
      if (isRaceLayout && atKm != null) {
        setPins({ a: atKm, b: km });
        return;
      }
      onPin(km);
    },
    [isRaceLayout, atKm, onPin]
  );

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

  const showPlanOnMap = !isRaceLayout && (tab === "racePlan" || showRacePlanOverlay);

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

  const handleSelectPoiFromMap = useCallback(
    (p: PoiRow) => {
      if (isRaceLayout && fieldProgramMode) {
        setFieldPoiTarget(p);
        setFieldAddLatLng(null);
        return;
      }
      if (isRaceLayout) {
        if (atKm != null) setPins({ a: atKm, b: p.along_km });
        else setPins({ a: p.along_km, b: null });
        return;
      }
      setSelectedPoi(p);
    },
    [isRaceLayout, fieldProgramMode, atKm]
  );

  const onFieldAddPoiMapClick = useCallback((lat: number, lng: number) => {
    setFieldAddLatLng({ lat, lng });
    setFieldPoiTarget(null);
  }, []);

  const onPoiPatched = useCallback((row: PoiRow) => {
    setPois((prev) => prev.map((x) => (x.id === row.id ? normalizePoiRow(row) : x)));
    setPoiEditTarget(null);
    setSelectedPoi((cur) => (cur?.id === row.id ? normalizePoiRow(row) : cur));
  }, []);

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

  const segmentRaceExtras = useMemo(() => {
    if (!isRaceLayout || pinAKm == null || pinBKm == null) return null;
    const lo = Math.min(pinAKm, pinBKm);
    const hi = Math.max(pinAKm, pinBKm);
    const span = hi - lo;
    if (span <= 0.02) return null;
    let unpaved = 0;
    for (const s of surfaceBands) {
      const a = Math.max(lo, s.km_start);
      const b = Math.min(hi, s.km_end);
      if (b > a && (s.surface === "gravel" || s.surface === "single")) unpaved += b - a;
    }
    const intermediatePois = mapPois
      .filter((p) => p.along_km > lo + 1e-6 && p.along_km < hi - 1e-6)
      .sort((a, b) => a.along_km - b.along_km)
      .slice(0, 14);
    return { unpavedPct: (unpaved / span) * 100, intermediatePois };
  }, [isRaceLayout, pinAKm, pinBKm, surfaceBands, mapPois]);

  const hoverElev = useMemo(() => {
    if (hoverKm == null) return null;
    return coordAtKm(initial.coords, hoverKm)?.elev ?? null;
  }, [hoverKm, initial.coords]);

  const tabButtons = useMemo(() => {
    if (isRaceLayout) {
      return [
        { id: "dashboard" as Tab, label: "Qui" },
        { id: "nextPoi" as Tab, label: "Prossimi POI" },
      ] as const;
    }
    return [
      { id: "dashboard" as Tab, label: "Qui e ora" },
      { id: "race" as Tab, label: "Gara" },
      { id: "roadbook" as Tab, label: "Roadbook" },
      { id: "list" as Tab, label: `Lista (${pois.length})` },
      { id: "checkpoints" as Tab, label: "Checkpoint" },
      { id: "racePlan" as Tab, label: "Piano gara" },
    ] as const;
  }, [isRaceLayout, pois.length]);

  const raceFilterChips = useMemo(
    () => (
      <>
        {(
          [
            ["water", "Acqua"],
            ["food", "Cibo"],
            ["sleep", "Dormire"],
            ["campsite", "Camp"],
            ["services", "Servizi"],
            ["all", "Tutto"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setRacePoiFilter(key)}
            className={`hmr-chip max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px] ${
              racePoiFilter === key ? "hmr-chip-on" : "hmr-chip-off"
            }`}
          >
            {label}
          </button>
        ))}
      </>
    ),
    [racePoiFilter]
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
      [...prev, normalizePoiRow(poi)].sort((a, b) => a.along_km - b.along_km)
    );
    setVisibleCategories((prev) => {
      if (prev.has(poi.category)) return prev;
      const next = new Set(prev);
      next.add(poi.category);
      return next;
    });
  }, []);

  const onFieldPoiAdded = useCallback(
    (poi: PoiRow, note?: PoiNoteWithPhotos) => {
      onPoiAdded(poi);
      if (note) onFieldNoteSaved(note);
    },
    [onPoiAdded, onFieldNoteSaved]
  );

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
        setPoiHarvestBannerExpanded(true);
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

  const scheduleClearFlyTo = useCallback(() => {
    window.setTimeout(() => setFlyToKmRange(null), 950);
  }, []);

  const onSelectSegmentFromPlan = useCallback(
    (kmStart: number, kmEnd: number) => {
      const lo = Math.min(kmStart, kmEnd);
      const hi = Math.max(kmStart, kmEnd);
      setPins({ a: lo, b: hi });
      setFlyToKmRange({ lo, hi });
      scheduleClearFlyTo();
      setSnap("peek");
      setTab("dashboard");
    },
    [scheduleClearFlyTo]
  );

  const onJumpToKmFromRace = useCallback(
    (km: number) => {
      const pad = 4;
      const lo = Math.max(0, km - pad);
      const hi = Math.min(initial.length_km, km + pad);
      setFlyToKmRange({ lo, hi });
      scheduleClearFlyTo();
      setSnap("peek");
      setTab("dashboard");
    },
    [initial.length_km, scheduleClearFlyTo]
  );

  const onMapViewportChange = useCallback((v: { lat: number; lng: number; zoom: number }) => {
    setMapViewport(v);
  }, []);

  const trackCenter = useMemo(
    () => ({
      lat: (initial.bbox.minLat + initial.bbox.maxLat) / 2,
      lon: (initial.bbox.minLng + initial.bbox.maxLng) / 2,
    }),
    [initial.bbox]
  );

  const mapChromeProps = {
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
    streetViewTrackId: initial.id,
    streetViewAroundKm: mediaAroundKm,
    streetViewPoints,
    onStreetViewLoaded: setStreetViewPoints,
    showStreetViewLayer,
    onShowStreetViewChange: setShowStreetViewLayer,
    windyActive,
    onWindyToggle: () => setWindyActive((v) => !v),
    ...(isRaceLayout
      ? {
          layout: "race" as const,
          onExitRaceLayout: endRace,
          raceFilterRow: raceFilterChips,
          fieldProgramMode,
          onToggleFieldProgram: toggleFieldProgram,
        }
      : { layout: "full" as const }),
  };

  const fieldMapPickActive = isRaceLayout && fieldProgramMode;

  return (
    <main
      className="relative w-full min-w-0 overflow-x-hidden"
      style={{ height: "100dvh" }}
    >
      <div className="absolute inset-0 overflow-hidden" style={{ height: "100dvh" }}>
        <MapView
          coords={initial.coords}
          bbox={initial.bbox}
          checkpoints={initial.checkpoints}
          resupply={initial.resupply}
          sections={initial.sections}
          bridges={initial.bridges ?? []}
          pois={mapPois}
          visibleCategories={categoriesForMap}
          showResupply={!isRaceLayout && showResupply}
          showSections={!isRaceLayout && showSections}
          myAlongKm={atKm}
          myPosition={myPosition}
          hoverKm={hoverKm}
          pinAKm={pinAKm}
          pinBKm={pinBKm}
          onHoverKm={setHoverKm}
          onPin={handleMapPin}
          onSelectPoi={handleSelectPoiFromMap}
          visitedPoiIds={visitedPoiIds}
          racePlanItems={overlayRacePlanItems}
          trackClickMode={
            addPoiMapPick
              ? "addPoi"
              : fieldMapPickActive
                ? "fieldAddPoi"
                : poiHarvestMode
                  ? "poiHarvest"
                  : tab === "racePlan" && racePlanMapPick
                    ? "racePlan"
                    : "measure"
          }
          onTrackKmPick={onTrackKmPick}
          onPoiHarvestClick={poiHarvestMode && !isRaceLayout ? onPoiHarvestClick : undefined}
          onAddPoiMapClick={
            addPoiMapPick
              ? onAddPoiMapClick
              : fieldMapPickActive
                ? onFieldAddPoiMapClick
                : undefined
          }
          surfaceSegments={surfaceBands}
          streetViewPoints={streetViewPoints}
          showStreetViewLayer={!isRaceLayout && showStreetViewLayer}
          flyToKmRange={flyToKmRange}
          onViewportChange={onMapViewportChange}
        />
      </div>

      {windyActive && (
        <WindyOverlay
          trackId={initial.id}
          lat={mapViewport?.lat ?? trackCenter.lat}
          lng={mapViewport?.lng ?? trackCenter.lon}
          zoom={mapViewport?.zoom ?? 7}
          mode={windyMode}
          onModeChange={setWindyMode}
          onClose={() => setWindyActive(false)}
        />
      )}

      {!wideRail && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex w-full min-w-0 flex-col gap-2 px-3 pt-[calc(var(--safe-top)+0.5rem)]">
          <MapChromeControls variant="overlay" {...mapChromeProps} />
        </header>
      )}
      {poiHarvestMode && !isRaceLayout &&
        (poiHarvestBannerExpanded ? (
        <div
          className={`pointer-events-none absolute left-3 right-3 z-30 flex justify-center ${
            wideRail
              ? "top-[calc(var(--safe-top)+0.65rem)]"
              : "top-[calc(var(--safe-top)+2.75rem)] max-sm:top-[calc(var(--safe-top)+2.5rem)]"
          }`}
        >
          <div className="pointer-events-auto flex max-h-[min(40vh,18rem)] max-w-lg flex-col overflow-hidden rounded-none border border-emerald-500/40 bg-[color:var(--hmr-panel-bg)] shadow-lg">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-emerald-500/25 px-2 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/95">OSM qui</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="hmr-btn hmr-tap rounded-none px-2 py-0.5 text-[10px]"
                  onClick={() => setPoiHarvestBannerExpanded(false)}
                >
                  Riduci
                </button>
                <button
                  type="button"
                  className="hmr-btn hmr-tap rounded-none px-2 py-0.5 text-[10px]"
                  onClick={togglePoiHarvestMode}
                >
                  Esci
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-3 py-2 text-center text-[11px] font-semibold leading-snug tracking-tight text-[color:var(--hmr-muted)]">
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
            <div className="mt-2 flex max-h-24 flex-wrap justify-center gap-x-3 gap-y-1 overflow-y-auto text-left text-[10px]">
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
        </div>
        ) : (
        <div
          className={`pointer-events-none absolute left-3 z-30 flex max-w-[min(calc(100vw-1.5rem),20rem)] ${
            wideRail ? "top-[calc(var(--safe-top)+0.65rem)]" : "top-[calc(var(--safe-top)+2.75rem)]"
          }`}
        >
          <div className="pointer-events-auto flex w-full items-center gap-2 rounded-none border border-emerald-500/40 bg-[color:var(--hmr-panel-bg)] px-2 py-1.5 text-[10px] shadow-lg">
            <span className="min-w-0 flex-1 truncate font-medium text-emerald-200/95">OSM · tap sulla mappa</span>
            <button
              type="button"
              className="hmr-btn hmr-tap shrink-0 rounded-none px-2 py-0.5 text-[10px]"
              onClick={() => setPoiHarvestBannerExpanded(true)}
            >
              Dettagli
            </button>
            <button
              type="button"
              className="hmr-btn hmr-tap shrink-0 rounded-none px-2 py-0.5 text-[10px]"
              onClick={togglePoiHarvestMode}
            >
              Esci
            </button>
          </div>
        </div>
        ))}

      <OfflineStatus trackId={initial.id} bbox={initial.bbox} />

      {measurement && (
        <MeasurementOverlay
          key={isRaceLayout ? `race-${pinAKm}-${pinBKm}` : "planner-measure"}
          measurement={measurement}
          trackLengthKm={initial.length_km}
          hoverKm={hoverKm}
          hoverElev={hoverElev}
          onReset={resetPins}
          onNudgeTarget={nudgeMeasurementTarget}
          hoverTerrainLabel={hoverTerrainLabel}
          hasSurfaceData={surfaceBands.length > 0}
          dockRight={wideRail}
          measureVariant={isRaceLayout ? "race" : "default"}
          segmentRaceExtras={segmentRaceExtras}
        />
      )}

      <div
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-[18] border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)]/97 shadow-[0_-6px_28px_rgba(0,0,0,0.42)] [@media(min-aspect-ratio:5/4)]:left-[var(--hmr-rail-width)]"
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
            onPinKm={handleMapPin}
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
        railNavVertical={wideRail && !isRaceLayout}
        header={
          <div
            className={`flex w-full min-w-0 items-center gap-0.5 ${wideRail && !isRaceLayout ? "flex-col items-stretch" : ""}`}
          >
            <nav
              className={`flex min-w-0 flex-1 gap-0.5 ${wideRail && !isRaceLayout ? "flex-col" : "flex-wrap"}`}
            >
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
            {!isRaceLayout && (
              <>
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
              className="hmr-chip hmr-chip-off shrink-0 px-2 py-0.5 text-[9px] font-medium leading-tight"
              onClick={() => setRacePreviewOpen(true)}
            >
              Anteprima Race
            </button>
              </>
            )}
          </div>
        }
      >
        {tab === "dashboard" && (
          <>
            {isNarrow && !raceActive && (
              <div className="flex flex-wrap gap-2 border-b border-[color:var(--hmr-border)]/50 px-3 py-2">
                <button
                  type="button"
                  className="hmr-btn hmr-btn-accent hmr-tap text-xs font-semibold"
                  onClick={startRace}
                >
                  Inizia gara (Race mobile)
                </button>
              </div>
            )}
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
            trackId={initial.id}
            pois={pois}
            resupply={initial.resupply}
            atKm={atKm}
            lengthKm={initial.length_km}
            visibleCategories={visibleCategories}
            onToggleCategory={onToggleCategory}
            showResupply={showResupply}
            onToggleResupply={() => setShowResupply((v) => !v)}
            onSelectPoi={(p) => setSelectedPoi(p)}
            onPoiUpdated={onPoiPatched}
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
        {tab === "nextPoi" && (
          <NextPoiList
            pois={mapPois}
            coords={initial.coords}
            atKm={atKm}
            lengthKm={initial.length_km}
            elevProfileGainScale={initial.elev_profile_gain_scale}
            elevProfileLossScale={initial.elev_profile_loss_scale}
            onSelectPoi={handleSelectPoiFromMap}
          />
        )}
        {tab === "race" && !isRaceLayout && (
          <RaceBriefPanel
            trackId={initial.id}
            lengthKm={initial.length_km}
            atKm={atKm}
            raceStarted={raceActive}
            onStartRace={startRace}
            onEndRace={endRace}
            racePlanName={selectedRacePlanName}
            racePlanUpcomingItems={raceBriefPlanUpcoming}
            onJumpToKm={onJumpToKmFromRace}
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
            onSelectSegment={onSelectSegmentFromPlan}
          />
        )}
      </BottomSheet>

      {selectedPoi && (
        <PoiModal
          poi={selectedPoi}
          trackId={initial.id}
          onClose={() => setSelectedPoi(null)}
          onEdit={() => setPoiEditTarget(selectedPoi)}
          onDeleted={(id) => {
            onPoiDeleted(id);
            setSelectedPoi(null);
          }}
        />
      )}

      {poiEditTarget && (
        <PoiEditSheet
          trackId={initial.id}
          poi={poiEditTarget}
          onClose={() => setPoiEditTarget(null)}
          onSaved={onPoiPatched}
        />
      )}

      {racePreviewOpen && (
        <div
          className="pointer-events-auto absolute inset-0 z-[38] flex flex-col bg-black/55 pt-[calc(var(--safe-top)+3.5rem)]"
          onClick={() => setRacePreviewOpen(false)}
        >
          <div
            className="mx-3 mb-[calc(var(--hmr-profile-strip)+var(--safe-bottom)+0.5rem)] flex max-h-[min(70vh,32rem)] min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--hmr-border)]/60 px-3 py-2 text-xs font-semibold">
              <span>Anteprima Race</span>
              <button type="button" className="hmr-btn hmr-tap text-xs" onClick={() => setRacePreviewOpen(false)}>
                Chiudi
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NextPoiList
                pois={pois.filter((p) => p.race_visible !== 0 && categoriesForMap.has(p.category))}
                coords={initial.coords}
                atKm={atKm}
                lengthKm={initial.length_km}
                elevProfileGainScale={initial.elev_profile_gain_scale}
                elevProfileLossScale={initial.elev_profile_loss_scale}
              />
            </div>
          </div>
        </div>
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

      {fieldPoiTarget && (
        <FieldPoiSheet
          trackId={initial.id}
          poi={fieldPoiTarget}
          initialNote={fieldNotes.get(fieldPoiTarget.id) ?? null}
          onClose={() => setFieldPoiTarget(null)}
          onSaved={onFieldNoteSaved}
        />
      )}

      {fieldAddLatLng && (
        <FieldAddPoiSheet
          trackId={initial.id}
          coords={initial.coords}
          lat={fieldAddLatLng.lat}
          lng={fieldAddLatLng.lng}
          onClose={() => setFieldAddLatLng(null)}
          onAdded={onFieldPoiAdded}
        />
      )}

      {fieldMapPickActive && !fieldPoiTarget && !fieldAddLatLng && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--safe-top)+3.25rem)] z-20 flex justify-center px-3">
          <p className="rounded-md border border-emerald-500/40 bg-[color:var(--hmr-panel-bg)]/95 px-3 py-1.5 text-center text-[10px] text-emerald-300 shadow-md backdrop-blur-sm">
            Programma sul campo: tocca un POI per confermare arrivo · tocca la mappa per nuovo POI
          </p>
        </div>
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
  measureVariant = "default",
  segmentRaceExtras = null,
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
  measureVariant?: "default" | "race";
  segmentRaceExtras?: { unpavedPct: number; intermediatePois: PoiRow[] } | null;
}) {
  type Fold = "micro" | "pill" | "expanded";
  const [fold, setFold] = useState<Fold>(measureVariant === "race" ? "micro" : "pill");

  const deltaElev =
    measurement.elevA != null && measurement.elevB != null
      ? measurement.elevB - measurement.elevA
      : null;
  const bLabel = measurement.bKm == null
    ? "—"
    : measurement.bIsCursor
      ? `cursore · km ${measurement.bKm.toFixed(1)}`
      : `km ${measurement.bKm.toFixed(1)}`;

  const pillSummaryShort =
    measurement.bKm != null
      ? `${measurement.distKm.toFixed(1)} km · D+${Math.round(measurement.gainM)}`
      : `A ${measurement.aKm.toFixed(1)} km`;

  const topPos = "top-[calc(var(--safe-top)+0.5rem)]";
  const bottomPos = "bottom-[calc(var(--hmr-profile-strip)+var(--safe-bottom)+4px)]";

  const detailPanel = (
    <div
      className={`pointer-events-auto max-h-[min(40vh,22rem)] overflow-y-auto hmr-panel px-2.5 py-1.5 text-[10px] shadow-lg sm:px-3 sm:py-2 sm:text-xs ${dockRight ? "text-right" : ""}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--hmr-muted)] sm:text-[10px]">
          Misura
        </span>
        <div className="flex gap-0.5">
          <button
            type="button"
            title="Comprimi"
            className="hmr-btn hmr-tap !min-h-0 !min-w-0 px-1.5 py-0.5 text-[9px]"
            onClick={() => setFold("pill")}
          >
            ↓
          </button>
          <button
            type="button"
            title="Solo icona"
            className="hmr-btn hmr-tap !min-h-0 !min-w-0 px-1.5 py-0.5 text-[9px]"
            onClick={() => setFold("micro")}
          >
            −
          </button>
          <button type="button" onClick={onReset} className="hmr-btn hmr-tap !min-h-0 !min-w-0 px-1.5 py-0.5 text-[9px]">
            ×
          </button>
        </div>
      </div>
      <p className="mb-1.5 text-[8px] leading-snug text-[color:var(--hmr-faint)] sm:text-[9px]">
        {measureVariant === "race"
          ? "Tap su traccia o POI: tratto da qui al punto."
          : "Profilo: trascina per A–B; tap per pin."}
      </p>
      {measurement.bKm == null && (
        <p className="mb-1.5 text-[9px] text-[color:var(--hmr-muted)]">Cursore + tap per B.</p>
      )}
      <div className="border-t border-[color:var(--hmr-border)]/60 pt-1.5">
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[9px] sm:text-[10px]">
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
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-center sm:grid-cols-4">
            <MetricCell label="Δkm" value={`${measurement.distKm.toFixed(2)}`} />
            <MetricCell label="D+" value={`${Math.round(measurement.gainM)} m`} />
            <MetricCell label="D-" value={`${Math.round(measurement.lossM)} m`} />
            <MetricCell
              label="Δ quota"
              value={deltaElev != null ? `${deltaElev > 0 ? "+" : ""}${Math.round(deltaElev)} m` : "—"}
            />
          </div>
          <div className="mt-1.5 border-t border-[color:var(--hmr-border)]/60 pt-1.5">
            <div className="text-[8px] uppercase tracking-[0.12em] text-[color:var(--hmr-muted)]">D+</div>
            <div className="text-base font-semibold tabular-nums leading-none text-[color:var(--hmr-text)] sm:text-lg">
              +{Math.round(measurement.gainM)} m
            </div>
          </div>
          {segmentRaceExtras && (
            <div className="mt-1.5 border-t border-[color:var(--hmr-border)]/60 pt-1.5 text-[9px] leading-snug text-[color:var(--hmr-muted)]">
              <div>
                Sterrato/sentiero ~{" "}
                <span className="font-semibold text-[color:var(--hmr-text)]">
                  {segmentRaceExtras.unpavedPct.toFixed(0)}%
                </span>
              </div>
              {segmentRaceExtras.intermediatePois.length > 0 && (
                <div className="mt-1">
                  <div className="text-[8px] uppercase tracking-wide text-[color:var(--hmr-faint)]">
                    POI sul tratto
                  </div>
                  <ul className="mt-0.5 list-inside list-disc">
                    {segmentRaceExtras.intermediatePois.map((p) => (
                      <li key={p.id} className="truncate">
                        {CATEGORY_META[p.category].short} ·{" "}
                        {p.name ?? CATEGORY_META[p.category].label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {hoverKm != null && measureVariant !== "race" && (
        <p className="mt-1.5 border-t border-[color:var(--hmr-border)]/60 pt-1.5 text-[9px] text-[color:var(--hmr-muted)]">
          Cursore km {hoverKm.toFixed(1)}
          {hoverElev != null ? ` · ${Math.round(hoverElev)} m` : ""}
          {hoverTerrainLabel && (
            <span className="block text-[color:var(--hmr-accent)]">OSM: {hoverTerrainLabel}</span>
          )}
          {!hoverTerrainLabel && hasSurfaceData && (
            <span className="block text-[color:var(--hmr-faint)]">Fuori dati OSM</span>
          )}
        </p>
      )}
      {measureVariant !== "race" && (
      <div className="mt-1.5 border-t border-[color:var(--hmr-border)]/60 pt-1.5 md:hidden">
        <p className="mb-1 text-[8px] text-[color:var(--hmr-muted)]">Parziale rapido</p>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { label: "+5", deltaKm: 5 },
              { label: "+10", deltaKm: 10 },
              { label: "+20", deltaKm: 20 },
            ] as const
          ).map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onNudgeTarget(item.deltaKm)}
              className="hmr-btn hmr-tap !min-h-0 rounded-none px-1.5 py-0.5 text-[8px]"
              disabled={measurement.aKm >= trackLengthKm - 0.05}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      )}
    </div>
  );

  if (dockRight) {
    if (fold === "micro") {
      return (
        <div className={`pointer-events-none absolute ${topPos} right-3 z-30`}>
          <button
            type="button"
            title="Misura — espandi"
            onClick={() => setFold("pill")}
            className="pointer-events-auto flex h-12 w-6 flex-col items-center justify-center rounded-l-md border border-[color:var(--hmr-border)]/90 bg-[color:var(--hmr-panel-bg)]/95 text-[8px] font-bold tabular-nums text-[color:var(--hmr-accent)] shadow-lg"
          >
            {measurement.bKm != null ? Math.round(measurement.gainM) : "⌃"}
          </button>
        </div>
      );
    }
    if (fold === "pill") {
      return (
        <div className={`pointer-events-none absolute ${topPos} right-3 z-30 flex max-w-[min(92vw,18rem)] flex-col items-end`}>
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[color:var(--hmr-border)]/90 bg-[color:var(--hmr-panel-bg)]/95 px-1.5 py-1 text-[8px] font-medium shadow-md backdrop-blur-sm">
            <span className="max-w-[11rem] truncate tabular-nums text-[color:var(--hmr-text)]">{pillSummaryShort}</span>
            <button
              type="button"
              title="Dettagli"
              className="hmr-btn hmr-tap !min-h-0 !min-w-0 shrink-0 rounded-full px-1 py-0.5 text-[9px]"
              onClick={() => setFold("expanded")}
            >
              ↑
            </button>
            <button
              type="button"
              title="Icona"
              className="hmr-btn hmr-tap !min-h-0 !min-w-0 shrink-0 rounded-full px-1 py-0.5 text-[9px]"
              onClick={() => setFold("micro")}
            >
              −
            </button>
            <button
              type="button"
              title="Reset"
              className="hmr-btn hmr-tap !min-h-0 !min-w-0 shrink-0 rounded-full px-1 py-0.5 text-[10px]"
              onClick={onReset}
            >
              ×
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className={`pointer-events-none absolute ${topPos} right-3 z-30 flex max-w-[min(92vw,22rem)] flex-col items-end gap-2`}>
        {detailPanel}
      </div>
    );
  }

  /* Mobile / overlay: in basso a destra sopra il profilo */
  if (fold === "micro") {
    return (
      <div className={`pointer-events-none absolute ${bottomPos} right-0 z-30`}>
        <button
          type="button"
          title="Misura — espandi"
          onClick={() => setFold("pill")}
          className="pointer-events-auto rounded-l-md border border-y border-l border-[color:var(--hmr-border)]/90 bg-[color:var(--hmr-panel-bg)]/96 px-1.5 py-2 text-[9px] font-semibold tabular-nums leading-tight text-[color:var(--hmr-text)] shadow-[2px_0_12px_rgba(0,0,0,0.35)] backdrop-blur-sm"
        >
          <span className="block max-w-[2.4rem] truncate text-[color:var(--hmr-muted)]">Δ</span>
          <span className="block text-[color:var(--hmr-accent)]">
            {measurement.bKm != null ? `+${Math.round(measurement.gainM)}` : "A"}
          </span>
        </button>
      </div>
    );
  }

  if (fold === "pill") {
    return (
      <div className={`pointer-events-none absolute ${bottomPos} right-2 z-30 flex max-w-[min(calc(100vw-5rem),16rem)] flex-col items-end`}>
        <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-l-md rounded-tr-md border border-[color:var(--hmr-border)]/90 bg-[color:var(--hmr-panel-bg)]/96 px-1.5 py-0.5 text-[8px] font-medium shadow-md backdrop-blur-sm">
          <span className="min-w-0 flex-1 truncate tabular-nums text-[color:var(--hmr-text)]">{pillSummaryShort}</span>
          <button
            type="button"
            title="Dettagli"
            className="hmr-btn hmr-tap !min-h-0 !min-w-0 shrink-0 rounded px-1 py-0 text-[9px] leading-none"
            onClick={() => setFold("expanded")}
          >
            ↑
          </button>
          <button
            type="button"
            title="Solo icona"
            className="hmr-btn hmr-tap !min-h-0 !min-w-0 shrink-0 rounded px-1 py-0 text-[9px] leading-none"
            onClick={() => setFold("micro")}
          >
            −
          </button>
          <button
            type="button"
            title="Reset pin"
            className="hmr-btn hmr-tap !min-h-0 !min-w-0 shrink-0 rounded px-1 py-0 text-[10px] leading-none"
            onClick={onReset}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`pointer-events-none absolute ${bottomPos} left-2 right-2 z-30 flex justify-end sm:left-auto sm:right-2 sm:max-w-[22rem]`}
    >
      {detailPanel}
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
  onEdit,
}: {
  poi: PoiRow;
  trackId: string;
  onClose: () => void;
  onDeleted?: (id: string) => void;
  onEdit?: () => void;
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
              {" · "}
              Race: {(poi.race_visible ?? 1) === 1 ? "visibile" : "nascosto"}
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
          {onEdit && (
            <button type="button" onClick={onEdit} className="hmr-btn hmr-tap text-xs">
              Modifica
            </button>
          )}
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
