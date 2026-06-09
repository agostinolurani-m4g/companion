"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StoredCoord } from "@/lib/track-coords";
import { useGpsRecorder } from "@/hooks/useGpsRecorder";
import MapView from "./MapView";
import { CATEGORY_ORDER } from "@/lib/categories";

type Props = {
  sessionEmail: string;
  initialActivityId?: string | null;
};

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function RecordApp({ sessionEmail, initialActivityId }: Props) {
  const router = useRouter();
  const recorder = useGpsRecorder(initialActivityId ?? null);
  const [tick, setTick] = useState(0);
  const [activityType, setActivityType] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    if (recorder.state !== "recording") return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [recorder.state]);

  useEffect(() => {
    if (initialActivityId && !startedRef.current && recorder.state === "idle") {
      startedRef.current = true;
      recorder.start().catch(() => {});
    }
  }, [initialActivityId, recorder]);

  const coords = useMemo((): StoredCoord[] => {
    let cum = 0;
    const out: StoredCoord[] = [];
    for (let i = 0; i < recorder.points.length; i++) {
      const p = recorder.points[i]!;
      if (i > 0) {
        const prev = recorder.points[i - 1]!;
        const R = 6371;
        const dLat = ((p.lat - prev.lat) * Math.PI) / 180;
        const dLng = ((p.lng - prev.lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((prev.lat * Math.PI) / 180) *
            Math.cos((p.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        cum += 2 * R * Math.asin(Math.sqrt(a));
      }
      out.push([
        p.lng,
        p.lat,
        p.eleM != null && Number.isFinite(p.eleM) ? p.eleM : null,
        cum,
      ]);
    }
    return out;
  }, [recorder.points]);

  const bbox = useMemo(() => {
    if (coords.length === 0) {
      return { minLng: 7.5, maxLng: 7.6, minLat: 45.0, maxLat: 45.1 };
    }
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    return {
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
    };
  }, [coords]);

  const lastPoint = recorder.points[recorder.points.length - 1];
  const myPosition = lastPoint ? { lat: lastPoint.lat, lng: lastPoint.lng } : null;
  const durationMs =
    recorder.startedAt && recorder.state === "recording"
      ? Date.now() - recorder.startedAt
      : 0;
  void tick;

  const onStart = async () => {
    try {
      if ("wakeLock" in navigator) {
        await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request("screen");
      }
      await recorder.start({ activityType: activityType || undefined });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const onStop = async () => {
    if (recorder.points.length < 2) {
      if (!window.confirm("Meno di 2 punti. Annullare la registrazione?")) return;
      await recorder.discard();
      return;
    }
    try {
      const result = await recorder.stop();
      if (result.trackId) {
        router.push(`/track/${encodeURIComponent(result.trackId)}?diario=1`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="pointer-events-auto absolute left-0 right-0 top-0 z-30 flex items-center justify-between gap-2 bg-[color:var(--hmr-bg)]/80 px-3 py-2 backdrop-blur-sm">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">Registra GPS</h1>
          <p className="text-[10px] text-[color:var(--hmr-muted)]">
            {sessionEmail} · {(recorder.distanceM / 1000).toFixed(2)} km
            {recorder.state === "recording" ? ` · ${formatDuration(durationMs)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Link href="/map" className="hmr-btn hmr-tap px-2 text-[10px]">
            Mappa
          </Link>
          <Link href="/" className="hmr-btn hmr-tap px-2 text-[10px]">
            Libreria
          </Link>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 pt-12">
        {coords.length >= 2 ? (
          <MapView
            coords={coords}
            bbox={bbox}
            pois={[]}
            visibleCategories={new Set(CATEGORY_ORDER)}
            myAlongKm={coords[coords.length - 1]?.[3] ?? null}
            myPosition={myPosition}
            hoverKm={null}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[color:var(--hmr-muted)]">
            Avvia la registrazione per tracciare il percorso sulla mappa.
          </div>
        )}
      </div>

      <footer className="pointer-events-auto border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] p-3 pb-[calc(0.75rem+var(--safe-bottom))]">
        {recorder.state === "idle" || recorder.state === "error" ? (
          <div className="space-y-2">
            <input
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
              placeholder="Tipo attività (opzionale)"
              className="hmr-input w-full text-xs"
            />
            <button
              type="button"
              onClick={() => void onStart()}
              className="hmr-btn hmr-tap w-full bg-emerald-700/80 py-3 text-sm font-semibold"
            >
              Start
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={recorder.state === "stopping"}
            onClick={() => void onStop()}
            className="hmr-btn hmr-tap w-full bg-red-800/80 py-3 text-sm font-semibold"
          >
            {recorder.state === "stopping" ? "Salvataggio…" : "Stop"}
          </button>
        )}
        {recorder.error ? (
          <p className="mt-2 text-center text-xs text-red-400">{recorder.error}</p>
        ) : null}
      </footer>
    </div>
  );
}
