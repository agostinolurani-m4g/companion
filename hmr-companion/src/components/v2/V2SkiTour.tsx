"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import V2Nav from "@/components/v2/V2Nav";
import V2PlanMap, { type V2MapClickTarget, type V2Waypoint } from "@/components/v2/V2PlanMap";
import V2SkiOutingPanel from "@/components/v2/V2SkiOutingPanel";
import V2SkiRouteBanner from "@/components/v2/V2SkiRouteBanner";
import ElevationChart from "@/components/ElevationChart";
import type { UserRouteVisibility } from "@/lib/db";
import { DEFAULT_MAP_VIEW_CENTER } from "@/lib/map-defaults";
import { sampleElevationsForLine } from "@/lib/elevation";
import type { StoredCoord } from "@/lib/track-coords";
import { elevationGainLossSmoothed, smoothElevationProfile } from "@/lib/track-geometry";
import { lineLengthKm } from "@/lib/osrm-route";
import type { RouteColoredSegment } from "@/lib/ors-route-tech";
import {
  AVALANCHE_LEGEND,
  buildSkiGeoJson,
  buildRouteMarkersGeoJsonFromTracks,
  parseSkiGeoJson,
  parseSkiWaypoints,
  shouldStripSkiWaypoints,
  SKI_TRACK_COLORS,
  SKI_AVALANCHE_DEFAULT_OPACITY,
  SKI_SLOPE_DEFAULT_OPACITY,
  SLOPE_LEGEND,
  type SkiTrackMode,
} from "@/lib/ski-overlays";
import {
  buildTrackColoredSegments,
  buildTrackFromWaypoints,
  elevationProfileAlongCoords,
  findSteepSegments,
  SKI_DENSIFY_STEP_M,
  SKI_GRADE_ALERT_PCT,
  SKI_GRADE_WARN_PCT,
  SKI_MAX_WAYPOINT_GAP_KM,
  type SteepSegment,
  validateWaypointGap,
} from "@/lib/ski-track";

type Props = {
  isAdmin?: boolean;
  username?: string;
};

const MODE_LABELS: Record<SkiTrackMode, string> = {
  ascent: "Salita",
  descent: "Discesa",
};

export default function V2SkiTour({ isAdmin = false, username }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeId = searchParams.get("route");

  const [trackMode, setTrackMode] = useState<SkiTrackMode>("ascent");
  const [ascentWaypoints, setAscentWaypoints] = useState<V2Waypoint[]>([]);
  const [descentWaypoints, setDescentWaypoints] = useState<V2Waypoint[]>([]);
  const [ascentCoords, setAscentCoords] = useState<[number, number][] | null>(null);
  const [descentCoords, setDescentCoords] = useState<[number, number][] | null>(null);
  const [lengthKm, setLengthKm] = useState(0);
  const [elevGainM, setElevGainM] = useState(0);
  const [elevLossM, setElevLossM] = useState(0);
  const [profileCoords, setProfileCoords] = useState<StoredCoord[]>([]);
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [ascentSteep, setAscentSteep] = useState<SteepSegment[]>([]);
  const [descentSteep, setDescentSteep] = useState<SteepSegment[]>([]);
  const [ascentElevAligned, setAscentElevAligned] = useState<{
    distanceKm: number[];
    elevationM: (number | null)[];
  } | null>(null);
  const [descentElevAligned, setDescentElevAligned] = useState<{
    distanceKm: number[];
    elevationM: (number | null)[];
  } | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [registerOuting, setRegisterOuting] = useState(true);
  const [outingDate, setOutingDate] = useState("");
  const [snowNotes, setSnowNotes] = useState("");
  const [participantsText, setParticipantsText] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; key?: number } | null>(
    null,
  );
  const [loadedMeta, setLoadedMeta] = useState<{
    owner: string;
    source: string | null;
    source_url: string | null;
    license: string | null;
  } | null>(null);

  const [slopeVisible, setSlopeVisible] = useState(true);
  const [avalancheVisible, setAvalancheVisible] = useState(false);
  const [avalancheGeoJson, setAvalancheGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [avalancheMeta, setAvalancheMeta] = useState<{
    publicationTime: string | null;
    message: string | null;
    available: boolean;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v2/groups");
        const data = (await res.json()) as { groups?: { id: string; name: string }[] };
        if (data.groups) setGroups(data.groups.map((g) => ({ id: g.id, name: g.name })));
      } catch {
        /* optional */
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v2/ski/avalanche");
        const data = (await res.json()) as {
          features?: GeoJSON.Feature[];
          meta?: {
            publicationTime: string | null;
            message: string | null;
            available: boolean;
          };
        };
        if (data.features) {
          setAvalancheGeoJson({ type: "FeatureCollection", features: data.features });
        }
        if (data.meta) setAvalancheMeta(data.meta);
      } catch {
        /* overlay opzionale */
      }
    })();
  }, []);

  const activeWaypoints = trackMode === "ascent" ? ascentWaypoints : descentWaypoints;

  useEffect(() => {
    if (ascentWaypoints.length < 2) {
      if (ascentWaypoints.length === 0) return;
      setAscentCoords(null);
      setAscentSteep([]);
      return;
    }
    setAscentCoords(buildTrackFromWaypoints(ascentWaypoints));
  }, [ascentWaypoints]);

  useEffect(() => {
    if (descentWaypoints.length < 2) {
      if (descentWaypoints.length === 0) return;
      setDescentCoords(null);
      setDescentSteep([]);
      return;
    }
    setDescentCoords(buildTrackFromWaypoints(descentWaypoints));
  }, [descentWaypoints]);

  useEffect(() => {
    const ascentLen = ascentCoords ? lineLengthKm(ascentCoords) : 0;
    const descentLen = descentCoords ? lineLengthKm(descentCoords) : 0;
    setLengthKm(ascentLen + descentLen);
  }, [ascentCoords, descentCoords]);

  const combinedCoords = useMemo(() => {
    const parts: [number, number][][] = [];
    if (ascentCoords && ascentCoords.length >= 2) parts.push(ascentCoords);
    if (descentCoords && descentCoords.length >= 2) parts.push(descentCoords);
    if (parts.length === 0) return null;
    const merged: [number, number][] = [];
    for (const part of parts) {
      if (merged.length === 0) {
        merged.push(...part);
        continue;
      }
      const last = merged[merged.length - 1];
      const first = part[0];
      const dup = last[0] === first[0] && last[1] === first[1];
      merged.push(...(dup ? part.slice(1) : part));
    }
    return merged.length >= 2 ? merged : null;
  }, [ascentCoords, descentCoords]);

  useEffect(() => {
    if (!ascentCoords || ascentCoords.length < 2) {
      setAscentSteep([]);
      setAscentElevAligned(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const maxPts = Math.min(ascentCoords.length, 500);
      const { distanceKm, elevationM, sampled } = await sampleElevationsForLine(
        ascentCoords,
        maxPts,
      );
      if (cancelled) return;
      const aligned = elevationProfileAlongCoords(
        ascentCoords,
        sampled as [number, number][],
        distanceKm,
        elevationM,
      );
      const elevNums = aligned.elevationM.map((e) => e ?? NaN);
      setAscentElevAligned(aligned);
      setAscentSteep(findSteepSegments(aligned.distanceKm, elevNums));
    })();
    return () => {
      cancelled = true;
    };
  }, [ascentCoords]);

  useEffect(() => {
    if (!descentCoords || descentCoords.length < 2) {
      setDescentSteep([]);
      setDescentElevAligned(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const maxPts = Math.min(descentCoords.length, 500);
      const { distanceKm, elevationM, sampled } = await sampleElevationsForLine(
        descentCoords,
        maxPts,
      );
      if (cancelled) return;
      const aligned = elevationProfileAlongCoords(
        descentCoords,
        sampled as [number, number][],
        distanceKm,
        elevationM,
      );
      const elevNums = aligned.elevationM.map((e) => e ?? NaN);
      setDescentElevAligned(aligned);
      setDescentSteep(findSteepSegments(aligned.distanceKm, elevNums));
    })();
    return () => {
      cancelled = true;
    };
  }, [descentCoords]);

  useEffect(() => {
    if (!combinedCoords || combinedCoords.length < 2) {
      setProfileCoords([]);
      setElevGainM(0);
      setElevLossM(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      const maxPts = Math.min(combinedCoords.length, 500);
      const positions = combinedCoords.map((c) => [c[0], c[1]] as [number, number]);
      const { distanceKm, elevationM, sampled } = await sampleElevationsForLine(positions, maxPts);
      if (cancelled) return;
      const { gain, loss } = elevationGainLossSmoothed(elevationM);
      setElevGainM(gain);
      setElevLossM(loss);
      const displayWindow = Math.max(3, Math.min(7, Math.round(elevationM.length / 20)));
      const smoothed = smoothElevationProfile(elevationM, displayWindow);
      setProfileCoords(
        sampled.map(
          (p, i) => [p[0], p[1], smoothed[i] ?? null, distanceKm[i] ?? 0] as StoredCoord,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [combinedCoords]);

  const routeColoredSegments = useMemo((): RouteColoredSegment[] | null => {
    const segments: RouteColoredSegment[] = [];
    if (ascentCoords && ascentCoords.length >= 2) {
      if (ascentElevAligned) {
        const elev = ascentElevAligned.elevationM.map((e) => e ?? NaN);
        segments.push(
          ...buildTrackColoredSegments(
            ascentCoords,
            ascentElevAligned.distanceKm,
            elev,
            SKI_TRACK_COLORS.ascent,
          ),
        );
      } else {
        segments.push({
          coordinates: ascentCoords,
          color: SKI_TRACK_COLORS.ascent,
          surface: "unknown",
        });
      }
    }
    if (descentCoords && descentCoords.length >= 2) {
      if (descentElevAligned) {
        const elev = descentElevAligned.elevationM.map((e) => e ?? NaN);
        segments.push(
          ...buildTrackColoredSegments(
            descentCoords,
            descentElevAligned.distanceKm,
            elev,
            SKI_TRACK_COLORS.descent,
          ),
        );
      } else {
        segments.push({
          coordinates: descentCoords,
          color: SKI_TRACK_COLORS.descent,
          surface: "unknown",
        });
      }
    }
    return segments.length > 0 ? segments : null;
  }, [ascentCoords, descentCoords, ascentElevAligned, descentElevAligned]);

  const routeMarkersGeoJson = useMemo(() => {
    return buildRouteMarkersGeoJsonFromTracks(ascentCoords, descentCoords, {
      elevGainM: elevGainM,
      elevLossM: elevLossM,
    });
  }, [ascentCoords, descentCoords, elevGainM, elevLossM]);

  const hasManualWaypoints = useMemo(() => {
    if (shouldStripSkiWaypoints(ascentWaypoints.map((w) => [w.lng, w.lat]), ascentCoords)) {
      return false;
    }
    if (shouldStripSkiWaypoints(descentWaypoints.map((w) => [w.lng, w.lat]), descentCoords)) {
      return false;
    }
    return ascentWaypoints.length > 0 || descentWaypoints.length > 0;
  }, [ascentWaypoints, descentWaypoints, ascentCoords, descentCoords]);

  const showTrackBanner = Boolean(
    (routeId && name) || (ascentCoords?.length || descentCoords?.length),
  );

  const mapWaypoints = useMemo(() => {
    const ascent = ascentWaypoints.map((w, i) => ({
      ...w,
      label: w.label ?? `S${i + 1}`,
    }));
    const descent = descentWaypoints.map((w, i) => ({
      ...w,
      label: w.label ?? `D${i + 1}`,
    }));
    return [...ascent, ...descent];
  }, [ascentWaypoints, descentWaypoints]);

  useEffect(() => {
    if (!routeId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/v2/routes/${encodeURIComponent(routeId)}`);
        const data = (await res.json()) as {
          error?: string;
          route?: {
            name: string;
            activity: string;
            owner: string;
            waypoints: unknown;
            geojson: GeoJSON.GeoJSON;
            length_km: number;
            elev_gain_m: number;
            elev_loss_m: number;
            source: string | null;
            source_url: string | null;
            license: string | null;
          };
        };
        if (!res.ok || !data.route) throw new Error(data.error ?? "Caricamento fallito");
        const r = data.route;
        if (r.activity !== "ski") throw new Error("Percorso non di scialpinismo");
        setName(r.name);
        const wp = parseSkiWaypoints(r.waypoints);
        const { ascentCoords: ac, descentCoords: dc } = parseSkiGeoJson(r.geojson);
        setAscentWaypoints(
          shouldStripSkiWaypoints(wp.ascent, ac) ? [] : wp.ascent.map(([lng, lat]) => ({ lng, lat })),
        );
        setDescentWaypoints(
          shouldStripSkiWaypoints(wp.descent, dc) ? [] : wp.descent.map(([lng, lat]) => ({ lng, lat })),
        );
        if (ac) setAscentCoords(ac);
        if (dc) setDescentCoords(dc);
        setLengthKm(r.length_km);
        setElevGainM(r.elev_gain_m);
        setElevLossM(r.elev_loss_m);
        setLoadedMeta({
          owner: r.owner,
          source: r.source,
          source_url: r.source_url,
          license: r.license,
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [routeId]);

  useEffect(() => {
    if (!routeId) return;
    const coords = combinedCoords ?? ascentCoords ?? descentCoords;
    if (!coords || coords.length < 2) return;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const c of coords) {
      minLng = Math.min(minLng, c[0]);
      maxLng = Math.max(maxLng, c[0]);
      minLat = Math.min(minLat, c[1]);
      maxLat = Math.max(maxLat, c[1]);
    }
    const span = Math.max(maxLng - minLng, maxLat - minLat);
    const zoom = span > 0.5 ? 10 : span > 0.15 ? 12 : span > 0.05 ? 13 : 14;
    setFlyTo({
      lng: (minLng + maxLng) / 2,
      lat: (minLat + maxLat) / 2,
      zoom,
      key: Date.now(),
    });
  }, [routeId, combinedCoords, ascentCoords, descentCoords]);

  const onMapInteraction = useCallback(
    (target: V2MapClickTarget) => {
      if (target.kind !== "map") return;
      const wp: V2Waypoint = { lng: target.lng, lat: target.lat };
      const list = trackMode === "ascent" ? ascentWaypoints : descentWaypoints;
      const prev = list[list.length - 1] ?? null;
      const gap = validateWaypointGap(prev, wp);
      if (!gap.ok) {
        setErr(
          `Tappa troppo distante (${Math.round(gap.distanceKm * 1000)} m). Massimo ${gap.maxGapKm * 1000} m — aggiungi un punto intermedio.`,
        );
        return;
      }
      setErr(null);
      if (trackMode === "ascent") {
        setAscentWaypoints((wps) => [...wps, wp]);
      } else {
        setDescentWaypoints((wps) => [...wps, wp]);
      }
    },
    [trackMode, ascentWaypoints, descentWaypoints],
  );

  const undoLastWaypoint = () => {
    if (trackMode === "ascent") {
      setAscentWaypoints((wps) => wps.slice(0, -1));
    } else {
      setDescentWaypoints((wps) => wps.slice(0, -1));
    }
  };

  const clearAll = () => {
    setAscentWaypoints([]);
    setDescentWaypoints([]);
    setAscentCoords(null);
    setDescentCoords(null);
    setLengthKm(0);
    setElevGainM(0);
    setElevLossM(0);
    setProfileCoords([]);
    setAscentSteep([]);
    setDescentSteep([]);
    setErr(null);
  };

  const saveRoute = async () => {
    if (!ascentCoords?.length && !descentCoords?.length) {
      setErr("Disegna almeno una traccia di salita o discesa");
      return;
    }
    setSaveBusy(true);
    setErr(null);
    try {
      const geojson = buildSkiGeoJson(ascentCoords, descentCoords);
      const routeVisibility: UserRouteVisibility = "public";
      const res = await fetch("/api/v2/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Percorso scialpinismo",
          activity: "ski",
          visibility: routeVisibility,
          length_km: lengthKm,
          elev_gain_m: elevGainM,
          elev_loss_m: elevLossM,
          waypoints: {
            ascent: ascentWaypoints.map((w) => [w.lng, w.lat] as [number, number]),
            descent: descentWaypoints.map((w) => [w.lng, w.lat] as [number, number]),
          },
          geojson,
        }),
      });
      const data = (await res.json()) as { error?: string; id?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Salvataggio fallito");

      if (registerOuting) {
        const participants = participantsText
          .split(/[,;\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const outingRes = await fetch("/api/v2/ski/outings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            route_id: data.id,
            title: name.trim() || "Gita scialpinismo",
            outing_date: outingDate || null,
            snow_notes: snowNotes,
            participants,
            group_ids: selectedGroupIds,
            make_route_public: true,
          }),
        });
        const outingData = (await outingRes.json()) as { error?: string };
        if (!outingRes.ok) throw new Error(outingData.error ?? "Registrazione gita fallita");
      }

      router.push(`/v2/scialpinismo/esplora`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hmr-panel z-10 flex max-h-[50vh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-[color:var(--hmr-border)]/60 p-3 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          <div>
            <h1 className="text-base font-semibold">Scialpinismo</h1>
            <p className="mt-0.5 text-xs text-[color:var(--hmr-muted)]">
              Traccia libera punto a punto: max {SKI_MAX_WAYPOINT_GAP_KM * 1000} m tra tappe,
              campionamento ogni {SKI_DENSIFY_STEP_M} m con analisi pendenza.
            </p>
            <Link
              href="/v2/scialpinismo/esplora"
              className="mt-2 mr-2 inline-block rounded-lg border border-[color:var(--hmr-border)] px-2.5 py-1 text-xs text-[color:var(--hmr-muted)]"
            >
              Esplora mappa
            </Link>
            <Link
              href="/v2/scialpinismo/nuova"
              className="mt-2 inline-block rounded-lg border border-[color:var(--hmr-accent)]/50 px-2.5 py-1 text-xs text-[color:var(--hmr-accent)]"
            >
              + Carica gita (audio/GPX)
            </Link>
          </div>

          <section className="rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)] p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
              Layer mappa
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={slopeVisible}
                onChange={(e) => setSlopeVisible(e.target.checked)}
              />
              Pendenza (OpenSlopeMap)
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SLOPE_LEGEND.filter((item) => item.color !== "transparent").map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1 text-[10px]">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm border border-black/20"
                    style={{ background: item.color }}
                  />
                  {item.label}
                </span>
              ))}
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={avalancheVisible}
                onChange={(e) => setAvalancheVisible(e.target.checked)}
              />
              Bollettino valanghe (EAWS)
            </label>
            {avalancheMeta ? (
              <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
                {avalancheMeta.available && avalancheMeta.publicationTime
                  ? `Bollettino del ${new Date(avalancheMeta.publicationTime).toLocaleString("it-IT")}`
                  : (avalancheMeta.message ?? "Fonte AINEVA / avalanche.report")}
              </p>
            ) : null}
            <div className="mt-2 flex flex-col gap-0.5">
              {AVALANCHE_LEGEND.map((item) => (
                <span key={item.level} className="inline-flex items-center gap-1.5 text-[10px]">
                  <span
                    className="inline-block h-2.5 w-5 rounded-sm border border-black/20"
                    style={{ background: item.color }}
                  />
                  {item.label}
                </span>
              ))}
            </div>
          </section>

          <div className="flex gap-1">
            {(["ascent", "descent"] as SkiTrackMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTrackMode(mode)}
                className={
                  trackMode === mode
                    ? "flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white"
                    : "flex-1 rounded-lg border border-[color:var(--hmr-border)] px-2.5 py-1.5 text-xs text-[color:var(--hmr-muted)]"
                }
                style={
                  trackMode === mode
                    ? { background: SKI_TRACK_COLORS[mode] }
                    : undefined
                }
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[color:var(--hmr-muted)]">
            Clicca sulla mappa per aggiungere tappe (max {SKI_MAX_WAYPOINT_GAP_KM * 1000} m tra
            due punti). Tratti con pendenza &gt;{SKI_GRADE_WARN_PCT}% sono evidenziati in arancio
            (&gt;{SKI_GRADE_ALERT_PCT}% in rosso).
          </p>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">Salita</div>
              <div className="font-medium" style={{ color: SKI_TRACK_COLORS.ascent }}>
                {ascentWaypoints.length} tappe
              </div>
            </div>
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">Discesa</div>
              <div className="font-medium" style={{ color: SKI_TRACK_COLORS.descent }}>
                {descentWaypoints.length} tappe
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">Km</div>
              <div className="font-medium">{lengthKm.toFixed(1)}</div>
            </div>
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">D+</div>
              <div className="font-medium">{Math.round(elevGainM)}</div>
            </div>
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">D-</div>
              <div className="font-medium">{Math.round(elevLossM)}</div>
            </div>
            <div className="rounded-lg bg-[color:var(--hmr-elev)] p-2">
              <div className="text-[9px] uppercase text-[color:var(--hmr-faint)]">Attiva</div>
              <div className="font-medium">{activeWaypoints.length}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={undoLastWaypoint}
              disabled={activeWaypoints.length === 0}
              className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Annulla ultima tappa
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={
                ascentWaypoints.length === 0 &&
                descentWaypoints.length === 0
              }
              className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 disabled:opacity-40"
            >
              Pulisci tutto
            </button>
          </div>

          {(ascentSteep.length > 0 || descentSteep.length > 0) && (
            <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
              <p className="font-medium text-amber-200">Tratti ripidi</p>
              {ascentSteep.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-[color:var(--hmr-muted)]">
                  {ascentSteep.map((s, i) => (
                    <li key={`a-${i}`}>
                      Salita km {s.kmStart.toFixed(2)}–{s.kmEnd.toFixed(2)}: pendenza max{" "}
                      {s.gradePctMax.toFixed(0)}% ({s.severity === "alert" ? "critica" : "attenzione"})
                    </li>
                  ))}
                </ul>
              ) : null}
              {descentSteep.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-[color:var(--hmr-muted)]">
                  {descentSteep.map((s, i) => (
                    <li key={`d-${i}`}>
                      Discesa km {s.kmStart.toFixed(2)}–{s.kmEnd.toFixed(2)}: pendenza max{" "}
                      {s.gradePctMax.toFixed(0)}% ({s.severity === "alert" ? "critica" : "attenzione"})
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}

          <div className="mt-auto space-y-2 border-t border-[color:var(--hmr-border)]/60 pt-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
              Percorso (pubblico)
            </p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome percorso"
              className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-3 py-2 text-sm"
            />

            {!routeId ? (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={registerOuting}
                  onChange={(e) => setRegisterOuting(e.target.checked)}
                />
                Registra anche la gita di oggi
              </label>
            ) : null}

            {registerOuting && !routeId ? (
              <div className="space-y-2 rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)] p-2.5">
                <p className="text-[10px] text-[color:var(--hmr-muted)]">
                  La gita è l&apos;uscita (data, neve, compagni). Il percorso resta pubblico e riusabile.
                </p>
                <input
                  type="date"
                  value={outingDate}
                  onChange={(e) => setOutingDate(e.target.value)}
                  className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1.5 text-xs"
                />
                <textarea
                  value={snowNotes}
                  onChange={(e) => setSnowNotes(e.target.value)}
                  rows={2}
                  placeholder="Condizioni neve, valanghe, note…"
                  className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1.5 text-xs"
                />
                <input
                  type="text"
                  value={participantsText}
                  onChange={(e) => setParticipantsText(e.target.value)}
                  placeholder="Compagni (username separati da virgola)"
                  className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1.5 text-xs"
                />
                {groups.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map((g) => {
                      const on = selectedGroupIds.includes(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() =>
                            setSelectedGroupIds((ids) =>
                              on ? ids.filter((id) => id !== g.id) : [...ids, g.id],
                            )
                          }
                          className={
                            on
                              ? "rounded-lg bg-[color:var(--hmr-accent)] px-2 py-0.5 text-[10px] text-[color:var(--hmr-bg)]"
                              : "rounded-lg border border-[color:var(--hmr-border)] px-2 py-0.5 text-[10px] text-[color:var(--hmr-muted)]"
                          }
                        >
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {routeId ? (
              <V2SkiOutingPanel routeId={routeId} routeName={name || "Percorso scialpinismo"} />
            ) : null}

            <button
              type="button"
              disabled={saveBusy || (!ascentCoords?.length && !descentCoords?.length)}
              onClick={() => void saveRoute()}
              className="w-full rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-sm font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
            >
              {saveBusy ? "Salvo…" : routeId ? "Salva percorso" : registerOuting ? "Salva percorso e gita" : "Salva percorso"}
            </button>
          </div>

          {err ? <p className="text-xs text-red-400">{err}</p> : null}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-[45vh] flex-1 lg:min-h-0">
            <V2PlanMap
              waypoints={mapWaypoints}
              routeCoords={null}
              routeColoredSegments={routeColoredSegments}
              routeMarkersGeoJson={routeMarkersGeoJson}
              pois={[]}
              onMapInteraction={onMapInteraction}
              showWaypoints={hasManualWaypoints}
              flyTo={flyTo}
              initialCenter={DEFAULT_MAP_VIEW_CENTER}
              slopeVisible={slopeVisible}
              slopeOpacity={SKI_SLOPE_DEFAULT_OPACITY}
              avalancheGeoJson={avalancheGeoJson}
              avalancheVisible={avalancheVisible}
              avalancheOpacity={SKI_AVALANCHE_DEFAULT_OPACITY}
            />
            {showTrackBanner ? (
              <V2SkiRouteBanner
                name={name || "Percorso scialpinismo"}
                lengthKm={lengthKm}
                elevGainM={elevGainM}
                elevLossM={elevLossM}
                owner={loadedMeta?.owner}
                source={loadedMeta?.source}
                sourceUrl={loadedMeta?.source_url}
                license={loadedMeta?.license}
              />
            ) : null}
          </div>
          {profileCoords.length >= 2 ? (
            <div className="shrink-0 border-t border-[color:var(--hmr-border)]/60 p-2">
              <ElevationChart
                coords={profileCoords}
                sections={[]}
                checkpoints={[]}
                atKm={null}
                hoverKm={hoverKm}
                onHoverKm={setHoverKm}
                surfaceBands={undefined}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
