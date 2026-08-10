"use client";

import { useCallback, useRef, useState } from "react";
import V2PlanMap, { type V2MapClickTarget } from "@/components/v2/V2PlanMap";
import { DEFAULT_MAP_VIEW_CENTER } from "@/lib/map-defaults";

type Props = {
  onClose: () => void;
  onUploaded: () => void;
  initialLng?: number;
  initialLat?: number;
};

export default function V2PhotoCapture({
  onClose,
  onUploaded,
  initialLng,
  initialLat,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [point, setPoint] = useState<{ lng: number; lat: number } | null>(
    initialLng != null && initialLat != null ? { lng: initialLng, lat: initialLat } : null,
  );
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"here" | "map">(point ? "map" : "here");

  const useHere = useCallback(() => {
    setGeoBusy(true);
    setErr(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErr("Geolocalizzazione non disponibile");
      setGeoBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({ lng: pos.coords.longitude, lat: pos.coords.latitude });
        setMode("here");
        setGeoBusy(false);
      },
      () => {
        setErr("Impossibile ottenere la posizione");
        setGeoBusy(false);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }, []);

  const onMapInteraction = useCallback((target: V2MapClickTarget) => {
    if (target.kind === "map") {
      setPoint({ lng: target.lng, lat: target.lat });
      setMode("map");
    }
  }, []);

  const upload = async () => {
    if (!point || !file) {
      setErr("Seleziona posizione e foto");
      return;
    }
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("lng", String(point.lng));
    fd.append("lat", String(point.lat));
    if (caption.trim()) fd.append("caption", caption.trim());
    try {
      const res = await fetch("/api/v2/photos", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload fallito");
      onUploaded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[95vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-[color:var(--hmr-border)] bg-[color:var(--hmr-panel)] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-[color:var(--hmr-border)]/60 px-4 py-3">
          <h2 className="text-sm font-medium">Carica foto</h2>
          <button type="button" onClick={onClose} className="text-xs text-[color:var(--hmr-muted)]">
            Chiudi
          </button>
        </div>

        <div className="flex gap-2 px-4 pt-3">
          <button
            type="button"
            disabled={geoBusy}
            onClick={useHere}
            className={
              mode === "here"
                ? "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs text-[color:var(--hmr-bg)]"
                : "rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs"
            }
          >
            {geoBusy ? "Localizzo…" : "Qui"}
          </button>
          <button
            type="button"
            onClick={() => setMode("map")}
            className={
              mode === "map"
                ? "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs text-[color:var(--hmr-bg)]"
                : "rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs"
            }
          >
            Tocca mappa
          </button>
        </div>

        <div className="h-48 shrink-0 px-4 py-2">
          <V2PlanMap
            waypoints={[]}
            routeCoords={null}
            pois={[]}
            pendingPoint={point}
            onMapInteraction={onMapInteraction}
            showWaypoints={false}
            initialCenter={
              point
                ? { lng: point.lng, lat: point.lat, zoom: 14 }
                : DEFAULT_MAP_VIEW_CENTER
            }
            flyTo={point ? { ...point, zoom: 14, key: point.lng + point.lat } : null}
          />
        </div>

        {point ? (
          <p className="px-4 text-[10px] text-[color:var(--hmr-muted)]">
            {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
          </p>
        ) : (
          <p className="px-4 text-[10px] text-[color:var(--hmr-muted)]">
            Usa &quot;Qui&quot; o tocca la mappa per scegliere il punto.
          </p>
        )}

        <div className="grid gap-3 px-4 py-3">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Didascalia (opzionale)"
            className="rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-dashed border-[color:var(--hmr-border)] px-3 py-4 text-xs text-[color:var(--hmr-muted)]"
          >
            {file ? file.name : "Scegli foto o scatta"}
          </button>
          <button
            type="button"
            disabled={busy || !point || !file}
            onClick={() => void upload()}
            className="rounded-lg bg-[color:var(--hmr-accent)] px-4 py-2.5 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
          >
            {busy ? "Carico…" : "Pubblica"}
          </button>
          {err ? <p className="text-xs text-red-400">{err}</p> : null}
        </div>
      </div>
    </div>
  );
}
