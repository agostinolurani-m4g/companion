"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  NotableSectionRow,
  PoiCategory,
  PoiRow,
  TrackDifficultySegmentRow,
  TrackJournalEntryRow,
  TrackSurfaceSegmentRow,
} from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import type { SportMode } from "@/lib/sport-modes";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { formatTerrainIt, surfaceKindAtKm } from "@/lib/surface-osm";
import { projectLngLatToTrack } from "@/lib/track-measure";
import AvalancheInfoBar from "./AvalancheInfoBar";
import BottomSheet, { type SheetSnap } from "./BottomSheet";
import DifficultyList from "./DifficultyList";
import ElevationChart from "./ElevationChart";
import JournalPanel from "./JournalPanel";
import MapView from "./MapView";
import PoiList from "./PoiList";

export type TrackPayload = {
  id: string;
  name: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  elev_profile_gain_scale: number;
  elev_profile_loss_scale: number;
  activity_type: string | null;
  sport_mode: SportMode;
  journal_summary: string | null;
  source: string;
  grade: string | null;
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  coords: StoredCoord[];
  pois: PoiRow[];
  surfaceSegments?: TrackSurfaceSegmentRow[];
  difficultySegments: TrackDifficultySegmentRow[];
  journalEntries: TrackJournalEntryRow[];
  notableSections: NotableSectionRow[];
};

type Tab = "map" | "pois" | "journal" | "attention";

type Props = {
  sessionEmail: string;
  initial: TrackPayload;
};

export default function PersonalApp({ sessionEmail, initial }: Props) {
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState(initial);
  const [tab, setTab] = useState<Tab>(
    searchParams.get("diario") === "1" ? "journal" : "map"
  );
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("peek");
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [focusKm, setFocusKm] = useState<number | null>(null);
  const [myAlongKm, setMyAlongKm] = useState<number | null>(null);
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsOn, setGpsOn] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<PoiRow | null>(null);
  const [journalSummary, setJournalSummary] = useState(initial.journal_summary);
  const [sportMode, setSportMode] = useState<SportMode>(initial.sport_mode);
  const [journalEntries, setJournalEntries] = useState(initial.journalEntries);
  const [difficultySegments, setDifficultySegments] = useState(initial.difficultySegments);
  const [grade, setGrade] = useState<string | null>(initial.grade);
  const [analyzing, setAnalyzing] = useState(false);
  const [hazardCells, setHazardCells] = useState<
    Array<{ lat: number; lng: number; report_kind: string; confirmed_at: number | null }>
  >([]);
  const [visibleCategories, setVisibleCategories] = useState<Set<PoiCategory>>(
    () => new Set(CATEGORY_ORDER)
  );

  const atKm = focusKm ?? hoverKm ?? myAlongKm;

  const toggleCategory = useCallback((c: PoiCategory) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!gpsOn) return;
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMyPosition({ lat, lng });
        const proj = projectLngLatToTrack(payload.coords, lng, lat);
        setMyAlongKm(proj?.alongKm ?? null);
      },
      () => setGpsOn(false),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [gpsOn, payload.coords]);

  useEffect(() => {
    const { bbox } = payload;
    void (async () => {
      const res = await fetch(
        `/api/hazards/cells?minLat=${bbox.minLat}&minLng=${bbox.minLng}&maxLat=${bbox.maxLat}&maxLng=${bbox.maxLng}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        cells: Array<{
          lat: number;
          lng: number;
          report_kind: string;
          confirmed_at: number | null;
        }>;
      };
      setHazardCells(data.cells.filter((c) => c.confirmed_at));
    })();
  }, [payload.bbox]);

  const analyzeDifficulty = useCallback(async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(payload.id)}/difficulty`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await res.json()) as {
        segments?: TrackDifficultySegmentRow[];
        grade?: string;
        error?: string;
      };
      if (res.ok && data.segments) {
        setDifficultySegments(data.segments);
        setGrade(data.grade ?? null);
        setPayload((p) => ({
          ...p,
          difficultySegments: data.segments!,
          notableSections: data.segments!.map((s) => ({
            id: s.id,
            label: s.label,
            km_start: s.km_start,
            km_end: s.km_end,
            severity:
              s.severity === "extreme" || s.severity === "hard"
                ? "hard"
                : s.severity === "caution"
                  ? "warn"
                  : "info",
            description: s.label,
          })),
        }));
      }
    } finally {
      setAnalyzing(false);
    }
  }, [payload.id]);

  const hoverTerrainLabel = useMemo(() => {
    if (atKm == null || !payload.surfaceSegments?.length) return null;
    const kind = surfaceKindAtKm(payload.surfaceSegments, atKm);
    return kind ? formatTerrainIt(kind) : null;
  }, [atKm, payload.surfaceSegments]);

  const surfaceBands = useMemo(
    () =>
      (payload.surfaceSegments ?? []).map((s) => ({
        km_start: s.km_start,
        km_end: s.km_end,
        surface: s.surface,
      })),
    [payload.surfaceSegments]
  );

  const midCoord = payload.coords[Math.floor(payload.coords.length / 2)];

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="pointer-events-auto absolute left-0 right-0 top-0 z-30 flex items-center justify-between gap-2 bg-[color:var(--hmr-bg)]/80 px-3 py-2 backdrop-blur-sm">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{payload.name}</h1>
          <p className="text-[10px] text-[color:var(--hmr-muted)]">
            {payload.length_km.toFixed(1)} km · D+ {Math.round(payload.elev_gain_m)} m
            {grade ? ` · ${grade}` : ""}
            {payload.source === "gps_record" ? " · GPS" : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setGpsOn((v) => !v)}
            className={`hmr-chip hmr-tap text-[10px] ${gpsOn ? "hmr-chip-on" : "hmr-chip-off"}`}
          >
            Posizione
          </button>
          <Link href="/record" className="hmr-btn hmr-tap px-2 text-[10px]">
            Registra
          </Link>
          <Link href="/map" className="hmr-btn hmr-tap px-2 text-[10px]">
            Overview
          </Link>
          <Link href="/" className="hmr-btn hmr-tap px-2 text-[10px]">
            Libreria
          </Link>
        </div>
      </header>

      <div
        className="relative min-h-0 flex-1 pt-12"
        style={{ paddingBottom: "calc(var(--hmr-profile-strip) + var(--safe-bottom))" }}
      >
        <MapView
          coords={payload.coords}
          bbox={payload.bbox}
          pois={payload.pois}
          visibleCategories={visibleCategories}
          myAlongKm={myAlongKm}
          myPosition={myPosition}
          hoverKm={atKm}
          onHoverKm={setHoverKm}
          onSelectPoi={setSelectedPoi}
          difficultySegments={difficultySegments}
          hazardCells={hazardCells}
        />
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 z-10"
        style={{
          bottom: "var(--safe-bottom)",
          height: "var(--hmr-profile-strip)",
        }}
      >
        <div className="pointer-events-auto h-full border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)]/95 backdrop-blur-sm">
          <ElevationChart
            coords={payload.coords}
            sections={payload.notableSections}
            checkpoints={[]}
            atKm={atKm}
            hoverKm={hoverKm}
            onHoverKm={setHoverKm}
            surfaceBands={surfaceBands}
            hoverTerrainLabel={hoverTerrainLabel}
            elevProfileGainScale={payload.elev_profile_gain_scale}
            elevProfileLossScale={payload.elev_profile_loss_scale}
            wrapperClassName="h-full"
          />
        </div>
      </div>

      <BottomSheet
        snap={sheetSnap}
        onSnapChange={setSheetSnap}
        reserveProfileStrip
        header={
          <div className="flex gap-1 p-2">
            {(["map", "pois", "journal", "attention"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  if (sheetSnap === "peek") setSheetSnap("half");
                }}
                className={`hmr-chip flex-1 justify-center text-[10px] ${tab === t ? "hmr-chip-on" : "hmr-chip-off"}`}
              >
                {t === "map" ? "Info" : t === "pois" ? "POI" : t === "journal" ? "Diario" : "Attenzione"}
              </button>
            ))}
          </div>
        }
      >
        {tab === "map" ? (
          <div className="space-y-3 p-3 text-sm">
            {sportMode === "ski_mountaineering" && midCoord ? (
              <AvalancheInfoBar lat={midCoord[1]} lng={midCoord[0]} />
            ) : null}
            <p className="text-xs text-[color:var(--hmr-muted)]">
              Utente: {sessionEmail}. GPS per posizione e segnalazioni.
            </p>
            {atKm != null ? (
              <p className="text-xs">
                Km {atKm.toFixed(1)}
                {hoverTerrainLabel ? ` · ${hoverTerrainLabel}` : ""}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1">
              {CATEGORY_ORDER.map((cat) => {
                const meta = CATEGORY_META[cat];
                const on = visibleCategories.has(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`hmr-chip text-[10px] ${on ? "hmr-chip-on" : "hmr-chip-off"}`}
                    style={on ? { color: meta.color } : undefined}
                  >
                    {meta.short}
                  </button>
                );
              })}
            </div>
            {selectedPoi ? (
              <div className="hmr-panel rounded-xl p-3 text-xs">
                <p className="font-medium">{selectedPoi.name ?? CATEGORY_META[selectedPoi.category].label}</p>
                <p className="mt-1 text-[color:var(--hmr-muted)]">
                  km {selectedPoi.along_km.toFixed(1)} · {CATEGORY_META[selectedPoi.category].label}
                </p>
                {selectedPoi.website ? (
                  <a
                    href={selectedPoi.website}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block text-[color:var(--hmr-accent)]"
                  >
                    Sito web
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : tab === "pois" ? (
          <PoiList
            pois={payload.pois}
            atKm={atKm}
            lengthKm={payload.length_km}
            visibleCategories={visibleCategories}
            onToggleCategory={toggleCategory}
            onSelectPoi={setSelectedPoi}
          />
        ) : tab === "journal" ? (
          <JournalPanel
            trackId={payload.id}
            lengthKm={payload.length_km}
            journalSummary={journalSummary}
            sportMode={sportMode}
            entries={journalEntries}
            atKm={atKm}
            myPosition={myPosition}
            grade={grade}
            onSummaryChange={setJournalSummary}
            onSportModeChange={setSportMode}
            onEntriesChange={setJournalEntries}
            onSelectKm={setFocusKm}
            onAnalyzeDifficulty={() => void analyzeDifficulty()}
            analyzing={analyzing}
          />
        ) : (
          <DifficultyList
            segments={difficultySegments}
            onSelectKm={setFocusKm}
          />
        )}
      </BottomSheet>
    </div>
  );
}
