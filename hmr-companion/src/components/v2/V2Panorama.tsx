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
import { sunPath, sunPosition, terrainSunTimes, type SunPathPoint } from "@/lib/sun";

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
async function startCompass(onHeading: (deg: number, beta: number | null) => void): Promise<() => void> {
  type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
  const D = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null) as IOSOrientation | null;
  if (!D) throw new Error("Bussola non disponibile su questo dispositivo");
  if (typeof D.requestPermission === "function" && (await D.requestPermission()) !== "granted") {
    throw new Error("Permesso bussola negato");
  }
  const handler = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
    if (typeof e.webkitCompassHeading === "number") onHeading(e.webkitCompassHeading, e.beta);
    else if (e.absolute && e.alpha != null) onHeading((360 - e.alpha) % 360, e.beta);
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
  sun,
  sunNow,
}: {
  pano: Panorama;
  selected: VisiblePeak | null;
  onSelect: (p: VisiblePeak) => void;
  heading: number | null;
  sun: SunPathPoint[] | null;
  sunNow: { azimuth: number; elevation: number } | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const n = pano.horizon.length;
  const step = pano.stepDeg;
  const labels = useMemo(() => declutterPeaks(pano.peaks, 1.6, 120), [pano]);
  const sunUp = useMemo(() => (sun ?? []).filter((p) => p.elevation > -2), [sun]);
  const terrainMax = Math.max(3, ...Array.from(pano.horizon), ...labels.map((p) => p.angle));
  // Il sole alto d'estate schiaccerebbe le montagne: si allarga la scala solo fino a +14°, il resto esce in alto.
  const sunMax = sunUp.length ? Math.max(...sunUp.map((p) => p.elevation)) : -90;
  const maxA = Math.max(terrainMax, Math.min(sunMax, terrainMax + 14)) + 0.8;
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
        {sunUp.length > 1
          ? [-360, 0, 360].map((k) => {
              let d = "";
              let prevAz: number | null = null;
              for (const p of sunUp) {
                const az = p.azimuth + k;
                // L'azimut non torna indietro: un salto vuol dire che si esce dalla fascia disegnata.
                d += `${prevAz == null || Math.abs(az - prevAz) > 30 ? "M" : "L"}${x(az).toFixed(1)},${y(p.elevation).toFixed(1)}`;
                prevAz = az;
              }
              return <path key={`sun-${k}`} d={d} fill="none" stroke="#f59e0b" strokeWidth={1.6} strokeDasharray="5 4" opacity={0.95} />;
            })
          : null}
        {sunUp
          .filter((p) => new Date(p.time).getMinutes() === 0)
          .flatMap((p) =>
            [-360, 0, 360].map((k) => {
              const az = p.azimuth + k;
              if (az < -WRAP_DEG || az > 360 + WRAP_DEG) return null;
              const hidden = p.elevation <= angleAt(pano.horizon, p.azimuth);
              return (
                <g key={`h-${p.time}-${k}`} opacity={hidden ? 0.45 : 1}>
                  <circle cx={x(az)} cy={y(p.elevation)} r={2.6} fill="#f59e0b" stroke="#fff" strokeWidth={0.8} />
                  <text x={x(az)} y={y(p.elevation) - 5} fontSize={9.5} fontWeight={600} textAnchor="middle" fill="#92400e">
                    {new Date(p.time).getHours()}
                  </text>
                </g>
              );
            }),
          )}
        {sunNow && sunNow.elevation > minA
          ? [-360, 0, 360].map((k) => (
              <circle key={`now-${k}`} cx={x(sunNow.azimuth + k)} cy={y(sunNow.elevation)} r={7} fill="#fbbf24" stroke="#fff" strokeWidth={1.5} />
            ))
          : null}
        {heading != null ? (
          <line x1={x(heading)} x2={x(heading)} y1={0} y2={H} stroke="#dc2626" strokeDasharray="4 4" strokeWidth={1.5} />
        ) : null}
      </svg>
    </div>
  );
}

const AR_FOV_KEY = "hmr-pano-ar-fov";

function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/**
 * Panorama in realtà aumentata: fotocamera posteriore a schermo intero, nomi
 * delle vette posizionati con bussola (azimut) e inclinazione del telefono.
 * Campo visivo e correzione della bussola regolabili (ogni telefono è diverso).
 */
function PanoramaAR({ pano, sun, onClose }: { pano: Panorama; sun: SunPathPoint[] | null; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [orient, setOrient] = useState<{ heading: number; pitch: number } | null>(null);
  const [fov, setFov] = useState(52);
  const [offsetDeg, setOffsetDeg] = useState(0);
  const [size, setSize] = useState({ w: 360, h: 640 });
  const labels = useMemo(() => declutterPeaks(pano.peaks, 1.2, 150), [pano]);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(AR_FOV_KEY));
      if (v >= 30 && v <= 90) setFov(v);
    } catch {
      /* preferenza facoltativa */
    }
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop: (() => void) | null = null;
    let alive = true;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Fotocamera non disponibile in questo browser");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        let last = 0;
        // Media mobile sull'azimut (attraverso 0/360) per togliere il tremolio della bussola.
        let hx = 0;
        let hy = 0;
        let pitchS: number | null = null;
        stop = await startCompass((h, beta) => {
          const r = (h * Math.PI) / 180;
          hx = hx * 0.8 + Math.sin(r) * 0.2;
          hy = hy * 0.8 + Math.cos(r) * 0.2;
          const pitch = beta == null ? 0 : beta - 90;
          pitchS = pitchS == null ? pitch : pitchS * 0.8 + pitch * 0.2;
          const t = Date.now();
          if (t - last < 50) return;
          last = t;
          setOrient({ heading: ((Math.atan2(hx, hy) * 180) / Math.PI + 360) % 360, pitch: pitchS });
        });
        if (!alive) stop();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Fotocamera o bussola non disponibili");
      }
    })();
    return () => {
      alive = false;
      stop?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const saveFov = (v: number) => {
    setFov(v);
    try {
      localStorage.setItem(AR_FOV_KEY, String(v));
    } catch {
      /* facoltativo */
    }
  };

  const heading = orient ? (orient.heading + offsetDeg + 360) % 360 : null;
  const vfov = (fov * size.h) / size.w;
  const px = (az: number) => size.w / 2 + (wrap180(az - (heading ?? 0)) / fov) * size.w;
  const py = (a: number) => size.h / 2 - ((a - (orient?.pitch ?? 0)) / vfov) * size.h;

  let horizonD = "";
  if (heading != null) {
    const n = pano.horizon.length;
    for (let dx = -fov / 2 - 2; dx <= fov / 2 + 2; dx += pano.stepDeg) {
      const az = (heading + dx + 360) % 360;
      const a = pano.horizon[Math.round(az / pano.stepDeg) % n];
      horizonD += `${horizonD ? "L" : "M"}${(size.w / 2 + (dx / fov) * size.w).toFixed(1)},${py(a).toFixed(1)}`;
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black text-white" role="dialog" aria-label="Panorama in realtà aumentata">
      <div ref={boxRef} className="absolute inset-0 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
        {heading != null ? (
          <svg className="absolute inset-0" width={size.w} height={size.h}>
            <path d={horizonD} fill="none" stroke="#fff" strokeWidth={1.2} strokeDasharray="6 5" opacity={0.6} />
            {sun
              ?.filter((p) => p.elevation > -1 && Math.abs(wrap180(p.azimuth - heading)) < fov / 2 + 5)
              .map((p) => (
                <circle key={p.time} cx={px(p.azimuth)} cy={py(p.elevation)} r={new Date(p.time).getMinutes() === 0 ? 3 : 1.4} fill="#fbbf24" />
              ))}
            {labels
              .filter((p) => Math.abs(wrap180(p.azimuth - heading)) < fov / 2 + 3)
              .map((p) => {
                const x = px(p.azimuth);
                const y = py(p.angle);
                const top = Math.max(40, y - 70);
                return (
                  <g key={p.id}>
                    <line x1={x} x2={x} y1={y - 4} y2={top} stroke="#fff" strokeWidth={1} opacity={0.85} />
                    <circle cx={x} cy={y} r={3} fill="#fff" stroke="#0f172a" />
                    <text
                      transform={`translate(${x + 3},${top - 4}) rotate(-50)`}
                      fontSize={13}
                      fontWeight={600}
                      fill="#fff"
                      stroke="#0f172a"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {p.name} {p.ele_used} m · {(p.distance_m / 1000).toFixed(p.distance_m < 10_000 ? 1 : 0)} km
                    </text>
                  </g>
                );
              })}
          </svg>
        ) : null}
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 pt-[max(12px,env(safe-area-inset-top))]">
        <span className="text-sm font-semibold">
          {heading != null && orient
            ? `${Math.round(heading)}° · inclinazione ${Math.round(orient.pitch)}°`
            : "Punta il telefono verso le montagne…"}
        </span>
        <button type="button" className="rounded-full bg-white/20 px-3 py-1 text-sm" onClick={onClose}>
          Chiudi
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-black/75 to-transparent p-3 pb-[max(12px,env(safe-area-inset-bottom))] text-[12px]">
        {err ? <p className="text-red-300">{err}</p> : null}
        <label className="flex items-center gap-2">
          Campo visivo {fov}°
          <input type="range" min={30} max={90} value={fov} onChange={(e) => saveFov(Number(e.target.value))} className="flex-1" />
        </label>
        <label className="flex items-center gap-2">
          Correggi bussola {offsetDeg > 0 ? "+" : ""}
          {offsetDeg}°
          <input type="range" min={-30} max={30} value={offsetDeg} onChange={(e) => setOffsetDeg(Number(e.target.value))} className="flex-1" />
        </label>
        <p className="text-white/70">La linea tratteggiata è l&apos;orizzonte calcolato: allineala alle creste con i due cursori.</p>
      </div>
    </div>
  );
}

function hhmm(t: number | null): string {
  return t == null ? "—" : new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function V2Panorama({ initial }: { initial: { lng: number; lat: number } | null }) {
  const [observer, setObserver] = useState<{ lng: number; lat: number } | null>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [pano, setPano] = useState<Panorama | null>(null);
  const [selected, setSelected] = useState<VisiblePeak | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [peaksLoading, setPeaksLoading] = useState(false);
  const [arOpen, setArOpen] = useState(false);
  const [sunDay, setSunDay] = useState<string>(() => todayIso());
  const [now, setNow] = useState(() => Date.now());
  const stopCompass = useRef<(() => void) | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const sun = useMemo(
    () => (pano ? sunPath(dayFromIso(sunDay), pano.observer.lat, pano.observer.lng, 10) : null),
    [pano, sunDay],
  );
  const sunTimes = useMemo(() => {
    if (!pano) return null;
    const n = pano.horizon.length;
    // Passo di 2 minuti per orari precisi; il disegno usa quello da 10.
    const fine = sunPath(dayFromIso(sunDay), pano.observer.lat, pano.observer.lng, 2);
    return terrainSunTimes(fine, (az) => pano.horizon[Math.round(az / pano.stepDeg) % n]);
  }, [pano, sunDay]);
  const sunNow = useMemo(
    () => (pano && sunDay === todayIso() ? sunPosition(now, pano.observer.lat, pano.observer.lng) : null),
    [pano, sunDay, now],
  );

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
            {pano && status === "ready" ? (
              <button type="button" className="ui-btn ui-btn-sm" onClick={() => setArOpen(true)} title="Nomi delle vette sulla fotocamera">
                <Icon name="panorama" size={14} /> AR
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)]">
        {status === "ready" && pano ? (
          <>
            <PanoramaView pano={pano} selected={selected} onSelect={setSelected} heading={heading} sun={sun} sunNow={sunNow} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[color:var(--hmr-border)] px-3 py-1.5 text-[11.5px]">
              <span className="inline-flex items-center gap-1 font-medium">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> Sole
              </span>
              <input
                type="date"
                value={sunDay}
                onChange={(e) => e.target.value && setSunDay(e.target.value)}
                className="rounded border border-[color:var(--hmr-border)] bg-transparent px-1 py-0.5 text-[11.5px]"
                aria-label="Giorno per il percorso del sole"
              />
              {sunTimes?.sunrise != null ? (
                <span>
                  Sole da qui: <b>{hhmm(sunTimes.sunrise)}</b> → <b>{hhmm(sunTimes.sunset)}</b> · {sunTimes.hours} h sopra le creste
                </span>
              ) : (
                <span>In questo giorno il sole non supera le creste</span>
              )}
            </div>
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
      {arOpen && pano ? <PanoramaAR pano={pano} sun={sun} onClose={() => setArOpen(false)} /> : null}
    </div>
  );
}
