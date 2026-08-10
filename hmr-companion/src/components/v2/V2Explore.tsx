"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import V2Nav from "@/components/v2/V2Nav";
import V2PhotoCapture from "@/components/v2/V2PhotoCapture";
import V2PlanMap, { type V2MapClickTarget } from "@/components/v2/V2PlanMap";
import V2ReportSheet, { V2ReportCreateSheet } from "@/components/v2/V2ReportSheet";
import V2SkiOutingPanel from "@/components/v2/V2SkiOutingPanel";
import V2SkiRouteBanner from "@/components/v2/V2SkiRouteBanner";
import type { UserRouteActivity } from "@/lib/db";
import { fetchJson } from "@/lib/fetch-json";
import {
  applyExploreSelection,
  exploreRouteView,
  type ExploreScope,
} from "@/lib/explore";
import { DEFAULT_MAP_VIEW_CENTER } from "@/lib/map-defaults";
import {
  buildRouteMarkersGeoJsonFromTracks,
  SKI_AVALANCHE_DEFAULT_OPACITY,
  SKI_SLOPE_DEFAULT_OPACITY,
  SKI_TRACK_COLORS,
} from "@/lib/ski-overlays";
import type { FieldReportKind } from "@/lib/field-reports";

type Props = {
  isAdmin?: boolean;
  username?: string;
};

type GroupItem = { id: string; name: string };

type RouteSummary = {
  id: string;
  name: string;
  owner: string;
  activity: UserRouteActivity;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  source: string | null;
  source_url: string | null;
  license: string | null;
  start: [number, number] | null;
  end: [number, number] | null;
  outing_count?: number;
};

type ReportDto = {
  id: string;
  author: string;
  kind: FieldReportKind;
  kind_label: string;
  description: string;
  confirmation_count: number;
  verified: boolean;
  status: string;
  viewer_confirmed?: boolean;
};

const ACTIVITIES: { value: UserRouteActivity | "all"; label: string }[] = [
  { value: "all", label: "Tutti" },
  { value: "ski", label: "Sci" },
  { value: "hike", label: "Trekking" },
  { value: "road", label: "Strada" },
  { value: "mtb", label: "MTB" },
  { value: "gravel", label: "Gravel" },
];

function routeEditorHref(activity: UserRouteActivity, id: string): string {
  return activity === "ski"
    ? `/v2/scialpinismo?route=${encodeURIComponent(id)}`
    : `/v2/plan?route=${encodeURIComponent(id)}`;
}

export default function V2Explore({ isAdmin = false, username }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialActivity = (searchParams.get("activity") as UserRouteActivity | "all" | null) ?? "all";

  const [scope, setScope] = useState<ExploreScope>("public");
  const [activity, setActivity] = useState<UserRouteActivity | "all">(initialActivity);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [exploreGeoJson, setExploreGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [outingPanelKey, setOutingPanelKey] = useState(0);
  const [openOutingForm, setOpenOutingForm] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; key?: number } | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [slopeVisible, setSlopeVisible] = useState(false);
  const [avalancheVisible, setAvalancheVisible] = useState(false);
  const [reportsVisible, setReportsVisible] = useState(true);
  const [photosVisible, setPhotosVisible] = useState(true);
  const [avalancheGeoJson, setAvalancheGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [reportsGeoJson, setReportsGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [photosGeoJson, setPhotosGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);

  const [reportMode, setReportMode] = useState(false);
  const [createReportAt, setCreateReportAt] = useState<{ lng: number; lat: number } | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportDto | null>(null);
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [mapBbox, setMapBbox] = useState<{ south: number; west: number; north: number; east: number } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v2/groups");
        const data = (await res.json()) as { groups?: GroupItem[] };
        if (data.groups) setGroups(data.groups.map((g) => ({ id: g.id, name: g.name })));
      } catch {
        /* optional */
      }
    })();
  }, []);

  useEffect(() => {
    if (activity !== "ski") return;
    void (async () => {
      try {
        const data = await fetchJson<{ features?: GeoJSON.Feature[] }>("/api/v2/ski/avalanche");
        if (data.features) {
          setAvalancheGeoJson({ type: "FeatureCollection", features: data.features });
        }
      } catch {
        /* optional */
      }
    })();
  }, [activity]);

  const loadOverlays = useCallback(async (bbox: typeof mapBbox) => {
    if (!bbox) return;
    const q = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
    try {
      const [rep, pho] = await Promise.all([
        fetchJson<{ geojson?: GeoJSON.FeatureCollection }>(`/api/v2/reports?bbox=${q}`),
        fetchJson<{ photos?: Array<{ id: string; lng: number; lat: number; owner: string }> }>(
          `/api/v2/photos?bbox=${q}`,
        ),
      ]);
      setReportsGeoJson(rep.geojson ?? { type: "FeatureCollection", features: [] });
      setPhotosGeoJson({
        type: "FeatureCollection",
        features: (pho.photos ?? []).map((p) => ({
          type: "Feature",
          properties: { photoId: p.id, owner: p.owner },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        })),
      });
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    if (mapBbox) void loadOverlays(mapBbox);
  }, [mapBbox, loadOverlays]);

  const loadExplore = useCallback(
    async (s: ExploreScope, act: UserRouteActivity | "all") => {
      setBusy(true);
      setErr(null);
      setSelectedRouteId(null);
      setFlyTo(null);
      try {
        const actQ = act === "all" ? "" : `&activity=${encodeURIComponent(act)}`;
        const data = await fetchJson<{
          geojson?: GeoJSON.FeatureCollection;
          routes?: RouteSummary[];
        }>(`/api/v2/explore?scope=${encodeURIComponent(s)}${actQ}`);
        setExploreGeoJson(data.geojson ?? { type: "FeatureCollection", features: [] });
        setRoutes(data.routes ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setExploreGeoJson({ type: "FeatureCollection", features: [] });
        setRoutes([]);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadExplore(scope, activity);
  }, [scope, activity, loadExplore]);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  );

  const displayGeoJson = useMemo(() => {
    if (!exploreGeoJson) return null;
    return applyExploreSelection(exploreGeoJson, selectedRouteId);
  }, [exploreGeoJson, selectedRouteId]);

  const routeMarkersGeoJson = useMemo(() => {
    if (!selectedRouteId || !exploreGeoJson) return null;
    let ac: [number, number][] | null = null;
    let dc: [number, number][] | null = null;
    for (const f of exploreGeoJson.features) {
      const p = f.properties as { routeId?: string; mode?: string };
      if (p.routeId !== selectedRouteId || f.geometry?.type !== "LineString") continue;
      const coords = f.geometry.coordinates as [number, number][];
      if (p.mode === "descent") dc = coords;
      else ac = coords;
    }
    return buildRouteMarkersGeoJsonFromTracks(ac, dc, {
      elevGainM: selectedRoute?.elev_gain_m ?? 0,
      elevLossM: selectedRoute?.elev_loss_m ?? 0,
    });
  }, [selectedRouteId, exploreGeoJson, selectedRoute]);

  useEffect(() => {
    if (!selectedRouteId || !exploreGeoJson) return;
    const view = exploreRouteView(exploreGeoJson, selectedRouteId);
    if (view) setFlyTo({ ...view, key: Date.now() });
  }, [selectedRouteId, exploreGeoJson]);

  const onMapInteraction = useCallback(
    (target: V2MapClickTarget) => {
      if (target.kind === "map" && reportMode) {
        setCreateReportAt({ lng: target.lng, lat: target.lat });
        setReportMode(false);
      }
    },
    [reportMode],
  );

  const scopeLabel = useMemo(() => {
    if (scope === "public") return "Pubblici";
    if (scope === "mine") return "Mie gite";
    const gid = scope.slice("group:".length);
    return groups.find((g) => g.id === gid)?.name ?? "Gruppo";
  }, [scope, groups]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hmr-panel z-10 flex max-h-[45vh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-[color:var(--hmr-border)]/60 p-3 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          <div>
            <h1 className="text-base font-semibold">Esplora</h1>
            <p className="mt-0.5 text-xs text-[color:var(--hmr-muted)]">
              Percorsi, gite, foto e segnalazioni sulla mappa.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href="/v2/plan" className="text-xs text-[color:var(--hmr-accent)]">
                + Nuovo percorso
              </Link>
              <Link
                href="/v2/scialpinismo"
                className={
                  activity === "ski"
                    ? "rounded-lg bg-[color:var(--hmr-accent)] px-2 py-0.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                    : "text-xs text-[color:var(--hmr-accent)]"
                }
              >
                Traccia
              </Link>
              <Link
                href="/v2/scialpinismo/nuova"
                className={
                  activity === "ski"
                    ? "rounded-lg border border-[color:var(--hmr-accent)] bg-[color:var(--hmr-accent)]/10 px-2 py-0.5 text-xs font-medium text-[color:var(--hmr-accent)]"
                    : "text-xs text-[color:var(--hmr-accent)]"
                }
              >
                Carica
              </Link>
            </div>
          </div>

          <section>
            <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
              Sport
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {ACTIVITIES.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setActivity(a.value)}
                  className={
                    activity === a.value
                      ? "rounded-lg bg-[color:var(--hmr-accent)] px-2 py-0.5 text-[10px] text-[color:var(--hmr-bg)]"
                      : "rounded-lg border border-[color:var(--hmr-border)] px-2 py-0.5 text-[10px]"
                  }
                >
                  {a.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
              Ambito
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(["public", "mine"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={
                    scope === s
                      ? "rounded-lg bg-[color:var(--hmr-accent)] px-2.5 py-1 text-xs font-medium text-[color:var(--hmr-bg)]"
                      : "rounded-lg border border-[color:var(--hmr-border)] px-2.5 py-1 text-xs"
                  }
                >
                  {s === "public" ? "Pubblici" : "Mie gite"}
                </button>
              ))}
              {groups.map((g) => {
                const gScope = `group:${g.id}` as ExploreScope;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setScope(gScope)}
                    className={
                      scope === gScope
                        ? "rounded-lg bg-[color:var(--hmr-accent)] px-2.5 py-1 text-xs font-medium text-[color:var(--hmr-bg)]"
                        : "rounded-lg border border-[color:var(--hmr-border)] px-2.5 py-1 text-xs"
                    }
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)] p-2.5">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={reportsVisible} onChange={(e) => setReportsVisible(e.target.checked)} />
              Segnalazioni
            </label>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={photosVisible} onChange={(e) => setPhotosVisible(e.target.checked)} />
              Foto
            </label>
            {activity === "ski" ? (
              <>
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={slopeVisible} onChange={(e) => setSlopeVisible(e.target.checked)} />
                  Pendenza
                </label>
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={avalancheVisible}
                    onChange={(e) => setAvalancheVisible(e.target.checked)}
                  />
                  Valanghe
                </label>
              </>
            ) : null}
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setReportMode((v) => !v)}
              className={
                reportMode
                  ? "rounded-lg bg-amber-500 px-2 py-1 text-[10px] text-slate-950"
                  : "rounded-lg border border-[color:var(--hmr-border)] px-2 py-1 text-[10px]"
              }
            >
              {reportMode ? "Tocca mappa…" : "Segnala"}
            </button>
            <button
              type="button"
              onClick={() => setShowPhotoCapture(true)}
              className="rounded-lg border border-[color:var(--hmr-border)] px-2 py-1 text-[10px] text-[color:var(--hmr-accent)]"
            >
              Foto
            </button>
          </div>

          <div className="text-xs text-[color:var(--hmr-muted)]">
            {scopeLabel}: {busy ? "…" : routes.length} percorsi
          </div>

          {!busy && routes.length > 0 ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {routes.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenOutingForm(false);
                      setSelectedRouteId(r.id);
                    }}
                    className={
                      selectedRouteId === r.id
                        ? "w-full rounded-lg bg-[color:var(--hmr-elev)] px-2 py-1.5 text-left font-medium"
                        : "w-full rounded-lg px-2 py-1.5 text-left text-[color:var(--hmr-muted)] hover:bg-[color:var(--hmr-elev)]"
                    }
                  >
                    {r.name}
                    <span className="ml-1 text-[10px] opacity-70">{r.length_km.toFixed(1)} km</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {selectedRoute ? (
            <V2SkiOutingPanel
              key={`${selectedRoute.id}-${outingPanelKey}`}
              routeId={selectedRoute.id}
              routeName={selectedRoute.name}
              initialShowForm={openOutingForm}
            />
          ) : null}

          {err ? <p className="text-xs text-red-400">{err}</p> : null}
        </aside>

        <div className="relative min-h-[50vh] flex-1 lg:min-h-0">
          <V2PlanMap
            waypoints={[]}
            routeCoords={null}
            pois={[]}
            onMapInteraction={onMapInteraction}
            onViewportChange={(bbox) => setMapBbox(bbox)}
            initialCenter={DEFAULT_MAP_VIEW_CENTER}
            exploreGeoJson={displayGeoJson}
            routeMarkersGeoJson={routeMarkersGeoJson}
            photosGeoJson={photosVisible ? photosGeoJson : null}
            reportsGeoJson={reportsVisible ? reportsGeoJson : null}
            onReportSelect={(reportId) => {
              const f = reportsGeoJson?.features.find(
                (x) => (x.properties as { reportId?: string }).reportId === reportId,
              );
              if (!f) return;
              const p = f.properties as {
                reportId: string;
                kindLabel: string;
                author: string;
                description: string;
                verified: boolean;
                confirmationCount: number;
              };
              setSelectedReport({
                id: p.reportId,
                author: p.author,
                kind: "other",
                kind_label: p.kindLabel,
                description: p.description,
                confirmation_count: p.confirmationCount,
                verified: p.verified,
                status: "active",
              });
            }}
            showWaypoints={false}
            onRouteSelect={setSelectedRouteId}
            flyTo={flyTo}
            slopeVisible={slopeVisible && activity === "ski"}
            slopeOpacity={SKI_SLOPE_DEFAULT_OPACITY}
            avalancheGeoJson={avalancheGeoJson}
            avalancheVisible={avalancheVisible && activity === "ski"}
            avalancheOpacity={SKI_AVALANCHE_DEFAULT_OPACITY}
          />
          {selectedRoute ? (
            <V2SkiRouteBanner
              name={selectedRoute.name}
              lengthKm={selectedRoute.length_km}
              elevGainM={selectedRoute.elev_gain_m}
              elevLossM={selectedRoute.elev_loss_m}
              owner={selectedRoute.owner}
              source={selectedRoute.source}
              sourceUrl={selectedRoute.source_url}
              license={selectedRoute.license}
              onOpen={() => router.push(routeEditorHref(selectedRoute.activity, selectedRoute.id))}
              onRegisterOuting={() => {
                setOpenOutingForm(true);
                setOutingPanelKey((k) => k + 1);
              }}
              onDismiss={() => setSelectedRouteId(null)}
            />
          ) : null}
        </div>
      </div>

      {createReportAt ? (
        <V2ReportCreateSheet
          lng={createReportAt.lng}
          lat={createReportAt.lat}
          onClose={() => setCreateReportAt(null)}
          onCreated={() => {
            setCreateReportAt(null);
            if (mapBbox) void loadOverlays(mapBbox);
          }}
        />
      ) : null}

      {selectedReport ? (
        <V2ReportSheet
          report={selectedReport}
          isSelf={selectedReport.author === username}
          onClose={() => setSelectedReport(null)}
          onConfirm={async (id) => {
            await fetch(`/api/v2/reports/${encodeURIComponent(id)}/confirm`, { method: "POST" });
            setSelectedReport(null);
            if (mapBbox) void loadOverlays(mapBbox);
          }}
          onResolve={async (id) => {
            await fetch(`/api/v2/reports/${encodeURIComponent(id)}/resolve`, { method: "POST" });
            setSelectedReport(null);
            if (mapBbox) void loadOverlays(mapBbox);
          }}
        />
      ) : null}

      {showPhotoCapture ? (
        <V2PhotoCapture
          onClose={() => setShowPhotoCapture(false)}
          onUploaded={() => {
            setShowPhotoCapture(false);
            if (mapBbox) void loadOverlays(mapBbox);
          }}
        />
      ) : null}
    </div>
  );
}
