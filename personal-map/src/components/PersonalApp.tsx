"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PoiCategory, PoiRow, TrackSurfaceSegmentRow } from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { formatTerrainIt, surfaceKindAtKm } from "@/lib/surface-osm";
import { projectLngLatToTrack } from "@/lib/track-measure";
import BottomSheet, { type SheetSnap } from "./BottomSheet";
import ElevationChart from "./ElevationChart";
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
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  coords: StoredCoord[];
  pois: PoiRow[];
  surfaceSegments?: TrackSurfaceSegmentRow[];
};

type Tab = "map" | "pois";

type Props = {
  sessionEmail: string;
  initial: TrackPayload;
};

export default function PersonalApp({ sessionEmail, initial }: Props) {
  const [payload] = useState(initial);
  const [tab, setTab] = useState<Tab>("map");
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("peek");
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [myAlongKm, setMyAlongKm] = useState<number | null>(null);
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsOn, setGpsOn] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<PoiRow | null>(null);
  const [visibleCategories, setVisibleCategories] = useState<Set<PoiCategory>>(
    () => new Set(CATEGORY_ORDER)
  );

  const atKm = hoverKm ?? myAlongKm;

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

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="pointer-events-auto absolute left-0 right-0 top-0 z-30 flex items-center justify-between gap-2 bg-[color:var(--hmr-bg)]/80 px-3 py-2 backdrop-blur-sm">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{payload.name}</h1>
          <p className="text-[10px] text-[color:var(--hmr-muted)]">
            {payload.length_km.toFixed(1)} km · D+ {Math.round(payload.elev_gain_m)} m
            {payload.activity_type ? ` · ${payload.activity_type}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setGpsOn((v) => !v)}
            className={`hmr-chip hmr-tap text-[10px] ${gpsOn ? "hmr-chip-on" : "hmr-chip-off"}`}
          >
            GPS
          </button>
          <Link href="/map" className="hmr-btn hmr-tap px-2 text-[10px]">
            Overview
          </Link>
          <Link href="/" className="hmr-btn hmr-tap px-2 text-[10px]">
            Libreria
          </Link>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 pt-12">
        <MapView
          coords={payload.coords}
          bbox={payload.bbox}
          pois={payload.pois}
          visibleCategories={visibleCategories}
          myAlongKm={myAlongKm}
          myPosition={myPosition}
          hoverKm={hoverKm}
          onHoverKm={setHoverKm}
          onSelectPoi={setSelectedPoi}
        />
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
        style={{ height: "var(--hmr-profile-strip)" }}
      >
        <div className="pointer-events-auto h-full border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)]/95">
          <ElevationChart
            coords={payload.coords}
            sections={[]}
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
            <button
              type="button"
              onClick={() => setTab("map")}
              className={`hmr-chip flex-1 justify-center text-xs ${tab === "map" ? "hmr-chip-on" : "hmr-chip-off"}`}
            >
              Info
            </button>
            <button
              type="button"
              onClick={() => setTab("pois")}
              className={`hmr-chip flex-1 justify-center text-xs ${tab === "pois" ? "hmr-chip-on" : "hmr-chip-off"}`}
            >
              POI
            </button>
          </div>
        }
      >
        {tab === "map" ? (
          <div className="space-y-3 p-3 text-sm">
            <p className="text-xs text-[color:var(--hmr-muted)]">
              Utente: {sessionEmail}. Posizione GPS libera (pulsante in alto) + proiezione sulla traccia.
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
        ) : (
          <PoiList
            pois={payload.pois}
            atKm={atKm}
            lengthKm={payload.length_km}
            visibleCategories={visibleCategories}
            onToggleCategory={toggleCategory}
            onSelectPoi={setSelectedPoi}
          />
        )}
      </BottomSheet>
    </div>
  );
}
