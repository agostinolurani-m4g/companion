"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import V2Nav from "@/components/v2/V2Nav";
import V2PlanMap from "@/components/v2/V2PlanMap";
import V2SkiOutingPanel from "@/components/v2/V2SkiOutingPanel";
import V2SkiRouteBanner from "@/components/v2/V2SkiRouteBanner";
import { fetchJson } from "@/lib/fetch-json";
import { DEFAULT_MAP_VIEW_CENTER } from "@/lib/map-defaults";
import {
  applyExploreSelection,
  exploreRouteView,
  type ExploreScope,
} from "@/lib/ski-explore";
import {
  buildRouteMarkersGeoJsonFromTracks,
  SKI_AVALANCHE_DEFAULT_OPACITY,
  SKI_SLOPE_DEFAULT_OPACITY,
  SKI_TRACK_COLORS,
} from "@/lib/ski-overlays";

type Props = {
  isAdmin?: boolean;
  username?: string;
};

type GroupItem = { id: string; name: string };

type RouteSummary = {
  id: string;
  name: string;
  owner: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  source: string | null;
  source_url: string | null;
  license: string | null;
  start: [number, number] | null;
  end: [number, number] | null;
  outing_count?: number;
  latest_outing_date?: string | null;
};

export default function V2SkiExplore({ isAdmin = false, username }: Props) {
  const router = useRouter();
  const [scope, setScope] = useState<ExploreScope>("public");
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [exploreGeoJson, setExploreGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [outingPanelKey, setOutingPanelKey] = useState(0);
  const [openOutingForm, setOpenOutingForm] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; key?: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [slopeVisible, setSlopeVisible] = useState(true);
  const [avalancheVisible, setAvalancheVisible] = useState(false);
  const [avalancheGeoJson, setAvalancheGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v2/groups");
        const data = (await res.json()) as { groups?: GroupItem[] };
        if (data.groups) {
          setGroups(data.groups.map((g) => ({ id: g.id, name: g.name })));
        }
      } catch {
        /* optional */
      }
    })();
  }, []);

  useEffect(() => {
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
  }, []);

  const loadExplore = useCallback(async (s: ExploreScope) => {
    setBusy(true);
    setErr(null);
    setSelectedRouteId(null);
    setFlyTo(null);
    try {
      const data = await fetchJson<{
        geojson?: GeoJSON.FeatureCollection;
        routes?: RouteSummary[];
      }>(`/api/v2/ski/explore?scope=${encodeURIComponent(s)}`);
      setExploreGeoJson(data.geojson ?? { type: "FeatureCollection", features: [] });
      setRoutes(data.routes ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setExploreGeoJson({ type: "FeatureCollection", features: [] });
      setRoutes([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadExplore(scope);
  }, [scope, loadExplore]);

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
            <h1 className="text-base font-semibold">Esplora gite</h1>
            <p className="mt-0.5 text-xs text-[color:var(--hmr-muted)]">
              Clicca una traccia per partenza/arrivo e dettagli.
            </p>
            <Link
              href="/v2/scialpinismo"
              className="mt-2 inline-block text-xs text-[color:var(--hmr-accent)] hover:underline"
            >
              ← Disegna / modifica percorso
            </Link>
          </div>

          <section>
            <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
              Ambito
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setScope("public")}
                className={
                  scope === "public"
                    ? "rounded-lg bg-[color:var(--hmr-accent)] px-2.5 py-1 text-xs font-medium text-[color:var(--hmr-bg)]"
                    : "rounded-lg border border-[color:var(--hmr-border)] px-2.5 py-1 text-xs text-[color:var(--hmr-muted)]"
                }
              >
                Pubblici
              </button>
              <button
                type="button"
                onClick={() => setScope("mine")}
                className={
                  scope === "mine"
                    ? "rounded-lg bg-[color:var(--hmr-accent)] px-2.5 py-1 text-xs font-medium text-[color:var(--hmr-bg)]"
                    : "rounded-lg border border-[color:var(--hmr-border)] px-2.5 py-1 text-xs text-[color:var(--hmr-muted)]"
                }
              >
                Mie gite
              </button>
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
                        : "rounded-lg border border-[color:var(--hmr-border)] px-2.5 py-1 text-xs text-[color:var(--hmr-muted)]"
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
              <input
                type="checkbox"
                checked={slopeVisible}
                onChange={(e) => setSlopeVisible(e.target.checked)}
              />
              Pendenza (OpenSlopeMap)
            </label>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={avalancheVisible}
                onChange={(e) => setAvalancheVisible(e.target.checked)}
              />
              Bollettino valanghe
            </label>
          </section>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-[color:var(--hmr-muted)]">{scopeLabel}:</span>
            <span className="font-medium">{busy ? "…" : routes.length} percorsi</span>
          </div>

          <div className="flex gap-3 text-[10px]">
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-1 w-4 rounded-full"
                style={{ background: SKI_TRACK_COLORS.ascent }}
              />
              Salita
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-1 w-4 rounded-full"
                style={{ background: SKI_TRACK_COLORS.descent }}
              />
              Discesa
            </span>
          </div>

          {!busy && routes.length > 0 ? (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
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
                    {scope !== "public" && (r.outing_count ?? 0) > 0 ? (
                      <span className="ml-1 text-[10px] text-[color:var(--hmr-accent)]">
                        · {r.outing_count} {r.outing_count === 1 ? "gita" : "gite"}
                      </span>
                    ) : null}
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
            onMapInteraction={() => {}}
            initialCenter={DEFAULT_MAP_VIEW_CENTER}
            exploreGeoJson={displayGeoJson}
            routeMarkersGeoJson={routeMarkersGeoJson}
            showWaypoints={false}
            onRouteSelect={setSelectedRouteId}
            flyTo={flyTo}
            slopeVisible={slopeVisible}
            slopeOpacity={SKI_SLOPE_DEFAULT_OPACITY}
            avalancheGeoJson={avalancheGeoJson}
            avalancheVisible={avalancheVisible}
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
              onOpen={() =>
                router.push(`/v2/scialpinismo?route=${encodeURIComponent(selectedRoute.id)}`)
              }
              onRegisterOuting={() => {
                setOpenOutingForm(true);
                setOutingPanelKey((k) => k + 1);
              }}
              onDismiss={() => setSelectedRouteId(null)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
