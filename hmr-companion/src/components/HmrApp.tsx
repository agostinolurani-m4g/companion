"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CheckpointRow,
  NotableSectionRow,
  PoiCategory,
  PoiRow,
  RacePlanWithItems,
  ResupplyRow,
  TrackSurfaceSegmentRow,
} from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import type { MapillaryAlongItem, StreetViewAlongItem } from "@/lib/along-media-types";
import { CATEGORY_ORDER } from "@/lib/categories";
import {
  dominantSurfaceAlongKm,
  formatTerrainIt,
  surfaceKindAtKm,
  type TrackSurfaceKind,
} from "@/lib/surface-osm";
import { coordAtKm, measureBetween, projectLngLatToTrack } from "@/lib/track-measure";
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

type Tab = "dashboard" | "list" | "checkpoints" | "racePlan";

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

export default function HmrApp({ initial }: { initial: TrackPayload }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [visibleCategories, setVisibleCategories] = useState<Set<PoiCategory>>(
    () => new Set<PoiCategory>(["water", "restaurant", "shop", "lodging", "hut"])
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
  const [mapPickedKm, setMapPickedKm] = useState<number | null>(null);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [poiHarvestMode, setPoiHarvestMode] = useState(false);
  const [poiHarvestBusy, setPoiHarvestBusy] = useState(false);
  const [poiHarvestMsg, setPoiHarvestMsg] = useState<string | null>(null);

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

  const resetPins = useCallback(() => setPins({ a: null, b: null }), []);

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
    setSurfaceSegmentsState(initial.surfaceSegments ?? []);
  }, [initial.surfaceSegments]);

  const activeRaceItems = useMemo(() => {
    if (tab !== "racePlan" || !selectedPlanId) return [];
    return racePlans.find((p) => p.id === selectedPlanId)?.items ?? [];
  }, [tab, racePlans, selectedPlanId]);

  const elevationRaceItems = useMemo(
    () =>
      activeRaceItems.map((it) => ({
        id: it.id,
        km_start: it.km_start,
        km_end: it.km_end,
        kind: it.kind,
        title: it.title,
      })),
    [activeRaceItems]
  );

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

  const abSegmentTerrainLabel = useMemo(() => {
    if (pinAKm == null || pinBKm == null || surfaceBands.length === 0) return null;
    const k = dominantSurfaceAlongKm(surfaceBands, pinAKm, pinBKm);
    return k ? formatTerrainIt(k) : null;
  }, [pinAKm, pinBKm, surfaceBands]);

  const [terrainSaving, setTerrainSaving] = useState(false);

  const saveTerrainToTrack = useCallback(
    async (surface: TrackSurfaceKind) => {
      if (pinAKm == null || pinBKm == null) return;
      const lo = Math.min(pinAKm, pinBKm);
      const hi = Math.max(pinAKm, pinBKm);
      setTerrainSaving(true);
      try {
        const res = await fetch(
          `/api/track/${encodeURIComponent(initial.id)}/surface-segments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ km_start: lo, km_end: hi, surface }),
          }
        );
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          segments?: TrackSurfaceSegmentRow[];
        };
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        if (Array.isArray(j.segments)) setSurfaceSegmentsState(j.segments);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      } finally {
        setTerrainSaving(false);
      }
    },
    [pinAKm, pinBKm, initial.id]
  );

  const saveTerrainToRacePlan = useCallback(
    async (surface: TrackSurfaceKind) => {
      if (!selectedPlanId) {
        window.alert('Seleziona un piano nel tab «Piano gara», poi riprova.');
        return;
      }
      if (pinAKm == null || pinBKm == null) return;
      const lo = Math.min(pinAKm, pinBKm);
      const hi = Math.max(pinAKm, pinBKm);
      setTerrainSaving(true);
      try {
        const res = await fetch(
          `/api/track/${encodeURIComponent(initial.id)}/race-plans/${encodeURIComponent(selectedPlanId)}/items`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "note",
              title: `Terreno: ${formatTerrainIt(surface)}`,
              body: `Segmento km ${lo.toFixed(1)}–${hi.toFixed(1)} (annotazione manuale).`,
              km_start: lo,
              km_end: hi,
              avoid_night: false,
            }),
          }
        );
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        const rel = await fetch(`/api/track/${encodeURIComponent(initial.id)}/race-plans`);
        const data = (await rel.json()) as { racePlans?: RacePlanWithItems[] };
        setRacePlans(data.racePlans ?? []);
        setTab("racePlan");
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      } finally {
        setTerrainSaving(false);
      }
    },
    [selectedPlanId, pinAKm, pinBKm, initial.id]
  );

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
        { id: "list" as Tab, label: `Lista (${pois.length})` },
        { id: "checkpoints" as Tab, label: "Checkpoint" },
        { id: "racePlan" as Tab, label: "Piano gara" },
      ] as const,
    [pois.length]
  );

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

  const onPoiHarvestClick = useCallback(
    async (lat: number, lng: number) => {
      setPoiHarvestBusy(true);
      setPoiHarvestMsg(null);
      try {
        const r = await fetch(
          `/api/track/${encodeURIComponent(initial.id)}/pois/harvest`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat, lng, radiusM: 450 }),
          }
        );
        const j = (await r.json()) as {
          error?: string;
          inserted?: number;
          skippedDetour?: number;
          skippedUnclassified?: number;
          osmReturned?: number;
          pois?: PoiRow[];
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
        setPoiHarvestMsg(
          `OSM ${j.osmReturned ?? 0} oggetti · +${j.inserted ?? 0} in elenco · oltre percorso ${j.skippedDetour ?? 0}` +
            (su > 0 ? ` · tag non mappati ${su}` : "")
        );
      } catch (e) {
        setPoiHarvestMsg((e as Error).message);
      } finally {
        setPoiHarvestBusy(false);
      }
    },
    [initial.id]
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
          racePlanItems={tab === "racePlan" ? activeRaceItems : []}
          trackClickMode={
            poiHarvestMode
              ? "poiHarvest"
              : tab === "racePlan" && racePlanMapPick
                ? "racePlan"
                : "measure"
          }
          onTrackKmPick={onTrackKmPick}
          onPoiHarvestClick={poiHarvestMode ? onPoiHarvestClick : undefined}
          surfaceSegments={surfaceBands}
          streetViewPoints={streetViewPoints}
          mapillaryPoints={mapillaryPoints}
          showStreetViewLayer={showStreetViewLayer}
          showMapillaryLayer={showMapillaryLayer}
        />
      </div>

      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 px-3 pt-[calc(var(--safe-top)+0.5rem)]"
      >
        <div className="pointer-events-auto hmr-panel flex items-center gap-3 px-3 py-2 shadow-lg">
          <div className="flex min-w-0 flex-col">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--hmr-muted)]">
              HMR 2026
            </span>
            <span className="truncate text-sm font-semibold">{initial.name}</span>
          </div>
          <div className="ml-auto flex min-w-0 flex-col items-end gap-1">
            <div className="grid grid-cols-3 gap-2 text-[10px] text-[color:var(--hmr-muted)]">
              <Stat label="Dist." value={`${initial.length_km.toFixed(0)} km`} />
              <Stat label="D+" value={`${Math.round(initial.elev_gain_m)} m`} />
              <Stat label="D-" value={`${Math.round(initial.elev_loss_m)} m`} />
            </div>
            {(surfaceKmSummary.asphalt +
              surfaceKmSummary.gravel +
              surfaceKmSummary.single +
              surfaceKmSummary.unknown) > 0.5 && (
              <div className="max-w-[18rem] text-right text-[9px] leading-tight text-[color:var(--hmr-faint)]">
                Strada: asfalto {surfaceKmSummary.asphalt.toFixed(0)} km · sterrato{" "}
                {surfaceKmSummary.gravel.toFixed(0)} km · single {surfaceKmSummary.single.toFixed(0)} km
                {surfaceKmSummary.unknown > 2 ? ` · n/d ${surfaceKmSummary.unknown.toFixed(0)} km` : ""}
              </div>
            )}
          </div>
        </div>
        <div className="pointer-events-auto flex flex-wrap gap-2">
          {CATEGORY_ORDER.map((cat) => {
            const on = visibleCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onToggleCategory(cat)}
                className={`hmr-chip ${on ? "hmr-chip-on" : "hmr-chip-off"}`}
                aria-pressed={on}
              >
                {labelForCategory(cat)}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowSections((v) => !v)}
            className={`hmr-chip ${showSections ? "hmr-chip-on" : "hmr-chip-off"}`}
          >
            ⚠️ Toughest
          </button>
          <button
            type="button"
            onClick={() => setShowResupply((v) => !v)}
            className={`hmr-chip ${showResupply ? "hmr-chip-on" : "hmr-chip-off"}`}
          >
            🧭 Resupply
          </button>
          <button
            type="button"
            onClick={() => setShowAddSheet(true)}
            className="hmr-chip hmr-chip-off"
            aria-label="Aggiungi POI da link Google Maps"
          >
            ➕ Aggiungi
          </button>
          <button
            type="button"
            onClick={togglePoiHarvestMode}
            disabled={poiHarvestBusy}
            className={`hmr-chip ${poiHarvestMode ? "hmr-chip-on" : "hmr-chip-off"}`}
            aria-pressed={poiHarvestMode}
            title="Clic sulla mappa: scarica POI OpenStreetMap attorno al punto (raggio ~450 m) e aggiunge quelli vicini al percorso"
          >
            {poiHarvestBusy ? "⏳ OSM…" : "🔍 OSM qui"}
          </button>
        </div>
      </header>
      {poiHarvestMode && (
        <div className="pointer-events-none absolute left-3 right-3 top-[7.5rem] z-30 flex justify-center">
          <div className="pointer-events-auto max-w-md rounded-md border border-emerald-500/40 bg-[color:var(--hmr-panel-bg)] px-3 py-2 text-center text-[11px] leading-snug text-[color:var(--hmr-muted)] shadow-lg">
            <span className="font-medium text-emerald-200/95">Cerca POI OSM</span>
            {" — "}
            Clicca sulla mappa sul paese o sull&apos;incrocio (non serve essere sulla linea gara).
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
          hoverKm={hoverKm}
          hoverElev={hoverElev}
          onReset={resetPins}
          hoverTerrainLabel={hoverTerrainLabel}
          abSegmentTerrainLabel={abSegmentTerrainLabel}
          hasSurfaceData={surfaceBands.length > 0}
          onSaveTerrainToTrack={saveTerrainToTrack}
          onSaveTerrainToRacePlan={saveTerrainToRacePlan}
          terrainSaving={terrainSaving}
        />
      )}

      <BottomSheet
        snap={snap}
        onSnapChange={setSnap}
        header={
          <div className="flex w-full items-center gap-2">
            <nav className="flex flex-1 gap-1">
              {tabButtons.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTab(t.id);
                    if (snap === "peek") setSnap("half");
                  }}
                  className={`hmr-chip hmr-tap ${
                    tab === t.id ? "hmr-chip-on" : "hmr-chip-off"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <button
              type="button"
              onClick={() => setSnap(snap === "full" ? "half" : "full")}
              className="hmr-btn hmr-tap text-xs"
            >
              {snap === "full" ? "↓" : "↑"}
            </button>
          </div>
        }
      >
        {snap !== "peek" && (
          <div className="px-3 pt-2">
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
              raceItems={tab === "racePlan" ? elevationRaceItems : []}
              surfaceBands={surfaceBands}
              hoverTerrainLabel={hoverTerrainLabel}
              elevProfileGainScale={initial.elev_profile_gain_scale}
              elevProfileLossScale={initial.elev_profile_loss_scale}
            />
          </div>
        )}
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
          onClose={() => setShowAddSheet(false)}
          onAdded={onPoiAdded}
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
  hoverKm,
  hoverElev,
  onReset,
  hoverTerrainLabel,
  abSegmentTerrainLabel,
  hasSurfaceData,
  onSaveTerrainToTrack,
  onSaveTerrainToRacePlan,
  terrainSaving,
}: {
  measurement: MeasurementInfo;
  hoverKm: number | null;
  hoverElev: number | null;
  onReset: () => void;
  hoverTerrainLabel: string | null;
  abSegmentTerrainLabel: string | null;
  hasSurfaceData: boolean;
  onSaveTerrainToTrack: (surface: TrackSurfaceKind) => void;
  onSaveTerrainToRacePlan: (surface: TrackSurfaceKind) => void;
  terrainSaving: boolean;
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
  const abLocked = measurement.bKm != null && !measurement.bIsCursor;
  return (
    <div className="pointer-events-none absolute left-3 top-[calc(var(--safe-top)+0.5rem)] z-30 flex max-w-[min(92vw,22rem)] flex-col items-stretch gap-2 pt-[6.5rem] sm:pt-[5.5rem]">
      <div className="pointer-events-auto hmr-panel px-3 py-2 text-xs shadow-lg">
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
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
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
        {measurement.bKm != null ? (
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <MetricCell label="Δkm" value={`${measurement.distKm.toFixed(2)}`} />
            <MetricCell label="D+" value={`${Math.round(measurement.gainM)} m`} />
            <MetricCell label="D-" value={`${Math.round(measurement.lossM)} m`} />
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
            Passa il cursore sulla traccia o sul grafico, poi clicca per piazzare B.
          </p>
        )}
        {deltaElev != null && measurement.bKm != null && (
          <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
            Δquota {deltaElev > 0 ? "+" : ""}
            {Math.round(deltaElev)} m
          </p>
        )}
        {hoverKm != null && (
          <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
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
        {abLocked && (
          <div className="mt-2 border-t border-[color:var(--hmr-border)]/60 pt-2">
            <p className="text-[10px] text-[color:var(--hmr-muted)]">
              Segmento A→B · terreno prevalente (stima OSM)
              {abSegmentTerrainLabel ? (
                <span className="ml-1 font-medium text-[color:var(--hmr-text)]">{abSegmentTerrainLabel}</span>
              ) : (
                <span className="ml-1 text-[color:var(--hmr-faint)]">—</span>
              )}
            </p>
            <p className="mb-1 mt-1 text-[10px] font-medium text-[color:var(--hmr-text)]">
              Salva sulla traccia (SQLite, mappa colorata):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["asphalt", "Asfalto"],
                  ["gravel", "Sterrato"],
                  ["single", "Single"],
                  ["unknown", "N/d"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={`db-${kind}`}
                  type="button"
                  disabled={terrainSaving}
                  onClick={() => onSaveTerrainToTrack(kind)}
                  className="hmr-btn hmr-tap rounded-lg px-2 py-1 text-[10px]"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mb-1 mt-2 text-[10px] text-[color:var(--hmr-faint)]">
              Solo nota nel piano gara (tab «Piano gara» attivo):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["asphalt", "Asfalto"],
                  ["gravel", "Sterrato"],
                  ["single", "Single"],
                  ["unknown", "N/d"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={`plan-${kind}`}
                  type="button"
                  disabled={terrainSaving}
                  onClick={() => onSaveTerrainToRacePlan(kind)}
                  className="hmr-btn hmr-tap rounded-lg border border-[color:var(--hmr-border)]/80 bg-transparent px-2 py-1 text-[10px] opacity-90"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-md bg-black/20 px-1 py-1">
      <span className="text-[9px] uppercase tracking-wide text-[color:var(--hmr-faint)]">{label}</span>
      <span className="text-[11px] font-medium text-[color:var(--hmr-text)]">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px] uppercase tracking-wide text-[color:var(--hmr-faint)]">{label}</span>
      <span className="text-xs font-medium text-[color:var(--hmr-text)]">{value}</span>
    </div>
  );
}

function labelForCategory(cat: PoiCategory): string {
  switch (cat) {
    case "water":
      return "💧 acqua";
    case "restaurant":
      return "🍽️ cibo";
    case "shop":
      return "🛒 spesa";
    case "lodging":
      return "🛏️ letto";
    case "hut":
      return "🏔️ rifugi";
    case "pharmacy":
      return "➕ salute";
    case "atm":
      return "💶 servizi";
    case "bus":
      return "🚌 bus";
    default:
      return cat;
  }
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
                <span className="ml-2 rounded-full border border-[color:var(--hmr-accent)]/60 bg-[color:var(--hmr-accent-dim)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--hmr-accent)]">
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
              📞 {poi.phone}
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
          <p className="mt-2 text-xs text-[color:var(--hmr-danger)]">⚠ {error}</p>
        )}
      </div>
    </div>
  );
}
