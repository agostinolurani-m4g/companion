"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import V2PlanMap, { type V2MapClickTarget } from "@/components/v2/V2PlanMap";
import Icon from "@/components/v2/ui/Icon";
import { demSamplerForBbox } from "@/lib/dem-sample";
import { fetchJson } from "@/lib/fetch-json";
import {
  COMPASS_LABELS,
  computePanorama,
  declutterPeaks,
  distanceM,
  RIDGE_BANDS_M,
  type Panorama,
  type PanoramaPeak,
  type VisiblePeak,
} from "@/lib/panorama";

const PX_PER_DEG = 11;
const WRAP_DEG = 40;
const H = 330;
const LABEL_H = 130;
const MAX_KM = 80;
const NEAR_KM = 9;
const RIDGE_COLORS = ["#1e293b", "#334155", "#4b5f78", "#7189a6", "#a7b8cc"];

type Status = "idle" | "loading" | "ready" | "error";

function bboxAround(lng: number, lat: number, km: number) {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { west: lng - dLng, east: lng + dLng, south: lat - dLat, north: lat + dLat };
}

/** Bussola del telefono (iOS chiede il permesso; altrove `deviceorientationabsolute`). */
async function startCompass(onHeading: (deg: number) => void): Promise<() => void> {
  type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
  const D = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null) as IOSOrientation | null;
  if (!D) throw new Error("Bussola non disponibile su questo dispositivo");
  if (typeof D.requestPermission === "function" && (await D.requestPermission()) !== "granted") {
    throw new Error("Permesso bussola negato");
  }
  const handler = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
    if (typeof e.webkitCompassHeading === "number") onHeading(e.webkitCompassHeading);
    else if (e.absolute && e.alpha != null) onHeading((360 - e.alpha) % 360);
  };
  const evt = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(evt, handler as EventListener);
  return () => window.removeEventListener(evt, handler as EventListener);
}

function PanoramaView({
  pano,
  selected,
  onSelect,
  heading,
}: {
  pano: Panorama;
  selected: VisiblePeak | null;
  onSelect: (p: VisiblePeak) => void;
  heading: number | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const n = pano.horizon.length;
  const step = pano.stepDeg;
  const labels = useMemo(() => declutterPeaks(pano.peaks, 1.6, 120), [pano]);
  const maxA = Math.max(3, ...Array.from(pano.horizon), ...labels.map((p) => p.angle)) + 0.8;
  const minA = Math.max(-8, Math.min(...Array.from(pano.horizon)) - 1.2);
  const W = (360 + 2 * WRAP_DEG) * PX_PER_DEG;
  const x = (az: number) => (az + WRAP_DEG) * PX_PER_DEG;
  const y = (a: number) => LABEL_H + ((maxA - a) / (maxA - minA)) * (H - LABEL_H - 18);
  const angleAt = (arr: Float32Array, az: number) => arr[((Math.round(az / step) % n) + n) % n];

  const linePath = (arr: Float32Array) => {
    let d = "";
    let pen = false;
    for (let az = -WRAP_DEG; az <= 360 + WRAP_DEG; az += step) {
      const a = angleAt(arr, az);
      if (!Number.isFinite(a)) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(az).toFixed(1)},${y(a).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const horizonArea = `${linePath(pano.horizon)} L${W},${H} L0,${H} Z`;

  // Centra su direzione bussola, altrimenti sulla vetta più alta visibile.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = heading ?? [...pano.peaks].sort((a, b) => b.ele_used - a.ele_used)[0]?.azimuth ?? 0;
    el.scrollTo({ left: x(target) - el.clientWidth / 2, behavior: heading != null ? "auto" : "smooth" });
  }, [pano, heading]);

  const ticks: number[] = [];
  for (let az = -WRAP_DEG - (-WRAP_DEG % 10); az <= 360 + WRAP_DEG; az += 10) ticks.push(az);

  return (
    <div ref={scrollRef} className="ui-no-scrollbar relative w-full overflow-x-auto overscroll-x-contain" style={{ height: H }}>
      <svg width={W} height={H} role="img" aria-label="Panorama delle vette">
        <defs>
          <linearGradient id="pano-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7cb4e6" />
            <stop offset="1" stopColor="#dbeafe" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#pano-sky)" />
        <path d={horizonArea} fill={RIDGE_COLORS[RIDGE_COLORS.length - 1]} />
        {/* Creste dalla più lontana alla più vicina: le vicine coprono le lontane. */}
        {[...pano.ridges.keys()].reverse().map((b) => (
          <path key={b} d={linePath(pano.ridges[b])} fill="none" stroke={RIDGE_COLORS[b]} strokeWidth={b < 2 ? 2 : 1.4} />
        ))}
        {ticks.map((az) => {
          const norm = ((az % 360) + 360) % 360;
          const label = COMPASS_LABELS[norm];
          return (
            <g key={az}>
              <line x1={x(az)} x2={x(az)} y1={H - 14} y2={H - (label ? 2 : 8)} stroke="#fff" strokeWidth={label ? 2 : 1} opacity={0.8} />
              <text x={x(az) + 3} y={H - 4} fontSize={label ? 12 : 9} fontWeight={label ? 700 : 400} fill="#fff">
                {label ?? `${norm}°`}
              </text>
            </g>
          );
        })}
        {[-1, 0, 1].flatMap((k) =>
          labels
            .map((p) => ({ p, az: p.azimuth + k * 360 }))
            .filter(({ az }) => az >= -WRAP_DEG && az <= 360 + WRAP_DEG)
            .map(({ p, az }) => {
              const px = x(az);
              const py = y(p.angle);
              const sel = selected?.id === p.id;
              return (
                <g key={`${p.id}-${k}`} onClick={() => onSelect(p)} style={{ cursor: "pointer" }}>
                  <line x1={px} x2={px} y1={LABEL_H - 6} y2={py - 2} stroke={sel ? "#dc2626" : "#0f172a"} strokeWidth={sel ? 1.6 : 0.8} opacity={0.75} />
                  <circle cx={px} cy={py} r={sel ? 3.5 : 2.2} fill={sel ? "#dc2626" : "#0f172a"} />
                  <text
                    transform={`translate(${px + 4},${LABEL_H - 8}) rotate(-60)`}
                    fontSize={11}
                    fontWeight={sel ? 700 : 500}
                    fill={sel ? "#b91c1c" : "#0f172a"}
                  >
                    {p.name}
                    <tspan fontSize={9.5} fill="#334155">
                      {" "}
                      {p.ele_used} m · {(p.distance_m / 1000).toFixed(p.distance_m < 10_000 ? 1 : 0)} km
                    </tspan>
                  </text>
                  <rect x={px - 7} y={0} width={14} height={py + 4} fill="transparent" />
                </g>
              );
            }),
        )}
        {heading != null ? (
          <line x1={x(heading)} x2={x(heading)} y1={0} y2={H} stroke="#dc2626" strokeDasharray="4 4" strokeWidth={1.5} />
        ) : null}
      </svg>
    </div>
  );
}

export default function V2Panorama({ initial }: { initial: { lng: number; lat: number } | null }) {
  const [observer, setObserver] = useState<{ lng: number; lat: number } | null>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [pano, setPano] = useState<Panorama | null>(null);
  const [selected, setSelected] = useState<VisiblePeak | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [peaksLoading, setPeaksLoading] = useState(false);
  const stopCompass = useRef<(() => void) | null>(null);

  useEffect(() => () => stopCompass.current?.(), []);

  useEffect(() => {
    if (!observer) return;
    let alive = true;
    setStatus("loading");
    setSelected(null);
    (async () => {
      try {
        // Le vette (Overpass, lento al primo accesso) arrivano dopo: l'orizzonte non le aspetta.
        const peaksP = fetchJson<{ peaks: PanoramaPeak[] }>(`/api/v2/panorama/peaks?lat=${observer.lat}&lng=${observer.lng}`)
          .then((r) => r.peaks)
          .catch(() => [] as PanoramaPeak[]);
        const [far, near] = await Promise.all([
          demSamplerForBbox(bboxAround(observer.lng, observer.lat, MAX_KM + 2), 9),
          demSamplerForBbox(bboxAround(observer.lng, observer.lat, NEAR_KM + 1), 12),
        ]);
        if (!alive) return;
        if (!far) throw new Error("Modello del terreno non raggiungibile");
        const sample = (lng: number, lat: number) =>
          near && distanceM(observer.lng, observer.lat, lng, lat) < NEAR_KM * 1000 ? (near(lng, lat) ?? far(lng, lat)) : far(lng, lat);
        // Lascia disegnare lo stato "calcolo" prima del lavoro sincrono.
        await new Promise((r) => setTimeout(r, 30));
        const opts = { maxDistanceM: MAX_KM * 1000, stepDeg: 0.5 };
        const p = computePanorama(sample, observer, [], opts);
        if (!alive) return;
        if (!p) throw new Error("Quota del punto non disponibile");
        setPano(p);
        setStatus("ready");
        setMsg(null);
        setPeaksLoading(true);
        const peaks = await peaksP;
        if (!alive) return;
        setPeaksLoading(false);
        if (peaks.length) {
          const withPeaks = computePanorama(sample, observer, peaks, opts);
          if (alive && withPeaks) setPano(withPeaks);
        }
      } catch (e) {
        if (!alive) return;
        setStatus("error");
        setMsg(e instanceof Error ? e.message : "Errore");
      }
    })();
    return () => {
      alive = false;
    };
  }, [observer]);

  const locate = () => {
    if (!navigator.geolocation) return setMsg("Geolocalizzazione non disponibile");
    navigator.geolocation.getCurrentPosition(
      (pos) => setObserver({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
      () => setMsg("Posizione non disponibile"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const toggleCompass = async () => {
    if (stopCompass.current) {
      stopCompass.current();
      stopCompass.current = null;
      setHeading(null);
      return;
    }
    try {
      let last = 0;
      stopCompass.current = await startCompass((h) => {
        const now = Date.now();
        if (now - last > 120) {
          last = now;
          setHeading(h);
        }
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Bussola non disponibile");
    }
  };

  const onMap = useCallback((t: V2MapClickTarget) => {
    if (t.kind === "map") setObserver({ lng: t.lng, lat: t.lat });
    else if (t.kind === "place") setObserver({ lng: t.place.lng, lat: t.place.lat });
    else if (t.kind === "feature") setObserver({ lng: t.feature.lng, lat: t.feature.lat });
  }, []);

  const fly = useMemo(() => (initial ? { ...initial, zoom: 11, key: 1 } : null), [initial]);
  const visibleBands = RIDGE_BANDS_M.slice(0, -1).map((m) => `${m / 1000} km`).join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-[200px] flex-1">
        <V2PlanMap
          waypoints={[]}
          routeCoords={null}
          pois={[]}
          onMapInteraction={onMap}
          showWaypoints={false}
          pendingPoint={observer}
          hoverPoint={selected ? { lng: selected.lng, lat: selected.lat } : null}
          flyTo={fly}
          initialCenter={initial ? { ...initial, zoom: 11 } : undefined}
          pickMapLabels
        />
        <div className="pointer-events-none absolute left-3 right-16 top-3 flex flex-col items-start gap-2">
          <div className="ui-glass pointer-events-auto rounded-xl px-3 py-2 text-[12.5px]">
            <div className="flex items-center gap-1.5 font-semibold">
              <Icon name="panorama" size={16} /> Panorama vette
            </div>
            <div className="text-[11.5px] text-[color:var(--hmr-muted)]">
              Tocca un punto o una vetta sulla mappa: calcolo cosa si vede da lì, fino a {MAX_KM} km.
            </div>
          </div>
          <div className="pointer-events-auto flex gap-1.5">
            <button type="button" className="ui-btn ui-btn-sm" onClick={locate}>
              <Icon name="locate" size={14} /> Qui
            </button>
            <button type="button" className="ui-btn ui-btn-sm" aria-pressed={heading != null} onClick={toggleCompass}>
              <Icon name="compass" size={14} /> {heading != null ? `${Math.round(heading)}°` : "Bussola"}
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)]">
        {status === "ready" && pano ? (
          <>
            <PanoramaView pano={pano} selected={selected} onSelect={setSelected} heading={heading} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11.5px] text-[color:var(--hmr-muted)]">
              <span>
                Da {pano.observer.ele} m · {peaksLoading ? "carico i nomi delle vette…" : `${pano.peaks.length} vette visibili`}
              </span>
              {selected ? (
                <span className="font-medium text-[color:var(--hmr-text)]">
                  {selected.name} · {selected.ele_used} m · {(selected.distance_m / 1000).toFixed(1)} km ·{" "}
                  {Math.round(selected.azimuth)}°
                </span>
              ) : (
                <span>Tocca un nome per vederlo sulla mappa</span>
              )}
              <span className="ml-auto">Creste: {visibleBands} · DEM ~100 m, verifica sul posto</span>
            </div>
          </>
        ) : (
          <div className="grid h-24 place-items-center px-4 text-center text-[12.5px] text-[color:var(--hmr-muted)]">
            {status === "loading"
              ? "Scarico il terreno e calcolo l'orizzonte…"
              : status === "error"
                ? msg
                : "Scegli un punto di osservazione sulla mappa."}
          </div>
        )}
        {msg && status !== "error" ? <p className="px-3 pb-2 text-[11.5px] text-[color:var(--hmr-danger)]">{msg}</p> : null}
      </div>
    </div>
  );
}
