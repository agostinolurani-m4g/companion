"use client";

import { useEffect, useState } from "react";
import type { PoiCategory, PoiRow } from "@/lib/db";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import type { StoredCoord } from "@/lib/track-coords";
import { projectLngLatToTrack } from "@/lib/track-measure";

type TabMode = "maps" | "coords";

type Props = {
  trackId: string;
  coords: StoredCoord[];
  onClose: () => void;
  onAdded: (poi: PoiRow) => void;
  mapPickActive: boolean;
  onRequestMapPick: () => void;
  pickedLngLat: { lat: number; lng: number } | null;
  onClearPick: () => void;
};

export default function AddPoiSheet({
  trackId,
  coords,
  onClose,
  onAdded,
  mapPickActive,
  onRequestMapPick,
  pickedLngLat,
  onClearPick,
}: Props) {
  const [tab, setTab] = useState<TabMode>("maps");
  const [mapsUrl, setMapsUrl] = useState("");
  const [latStr, setLatStr] = useState("");
  const [lngStr, setLngStr] = useState("");
  const [category, setCategory] = useState<PoiCategory>("lodging");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);

  useEffect(() => {
    if (pickedLngLat) {
      setTab("coords");
      setLatStr(String(pickedLngLat.lat));
      setLngStr(String(pickedLngLat.lng));
      onClearPick();
    }
  }, [pickedLngLat, onClearPick]);

  type Preview =
    | null
    | { kind: "ok"; alongKm: number; detourM: number }
    | { kind: "far" };
  const preview: Preview =
    latStr && lngStr
      ? (() => {
          const lat = Number(latStr.replace(",", "."));
          const lng = Number(lngStr.replace(",", "."));
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const p = projectLngLatToTrack(coords, lng, lat);
          if (!p) return { kind: "far" };
          return {
            kind: "ok",
            alongKm: p.alongKm,
            detourM: Math.round(p.distKm * 1000),
          };
        })()
      : null;

  const useGeolocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Geolocalizzazione non disponibile.");
      return;
    }
    setGeoBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setTab("coords");
        setLatStr(String(pos.coords.latitude));
        setLngStr(String(pos.coords.longitude));
        setGeoBusy(false);
      },
      (err) => {
        setGeoBusy(false);
        setError(err.code === err.PERMISSION_DENIED ? "Permesso GPS negato." : "GPS non disponibile.");
      },
      { enableHighAccuracy: true, timeout: 20_000 }
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      let body: Record<string, unknown>;
      if (tab === "maps") {
        if (!mapsUrl.trim()) {
          setError("Incolla un link Google Maps.");
          setPending(false);
          return;
        }
        body = {
          mapsUrl: mapsUrl.trim(),
          category,
          name: name.trim() || undefined,
          notes: notes.trim() || undefined,
        };
      } else {
        const lat = Number(latStr.replace(",", "."));
        const lng = Number(lngStr.replace(",", "."));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          setError("Latitudine e longitudine non valide.");
          setPending(false);
          return;
        }
        body = {
          lat,
          lng,
          category,
          name: name.trim() || undefined,
          notes: notes.trim() || undefined,
        };
      }

      const res = await fetch(`/api/track/${trackId}/pois/custom`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { poi?: PoiRow; error?: string };
      if (!res.ok || !data.poi) {
        setError(data.error ?? "Errore sconosciuto");
        return;
      }
      onAdded(data.poi);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2.5 py-2 text-sm text-[color:var(--hmr-text)] outline-none placeholder:text-[color:var(--hmr-faint)] focus:border-[color:var(--hmr-accent)]";

  return (
    <div
      className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 pb-[calc(var(--safe-bottom)+1rem)] sm:items-center sm:pb-0"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="hmr-panel m-3 w-full max-w-md space-y-3 p-4 text-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-base font-semibold">Aggiungi POI</h4>
            <p className="text-[10px] text-[color:var(--hmr-muted)]">
              Link Google Maps, coordinate o GPS. Il punto viene proiettato sul GPX per km e detour.
            </p>
          </div>
          <button type="button" onClick={onClose} className="hmr-btn hmr-tap text-xs">
            Chiudi
          </button>
        </div>

        <div className="flex gap-1">
          <button
            type="button"
            className={`hmr-chip hmr-tap ${tab === "maps" ? "hmr-chip-on" : "hmr-chip-off"}`}
            onClick={() => setTab("maps")}
          >
            Link Maps
          </button>
          <button
            type="button"
            className={`hmr-chip hmr-tap ${tab === "coords" ? "hmr-chip-on" : "hmr-chip-off"}`}
            onClick={() => setTab("coords")}
          >
            Coordinate
          </button>
        </div>

        {tab === "maps" ? (
          <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
            Link Google Maps
            <textarea
              value={mapsUrl}
              onChange={(e) => setMapsUrl(e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
              rows={2}
              className={inputCls}
            />
          </label>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="hmr-btn hmr-tap text-xs"
                onClick={useGeolocation}
                disabled={geoBusy}
              >
                {geoBusy ? "GPS…" : "Usa posizione"}
              </button>
              <button
                type="button"
                className={`hmr-btn hmr-tap text-xs ${mapPickActive ? "hmr-btn-accent" : ""}`}
                onClick={onRequestMapPick}
              >
                {mapPickActive ? "Clic sulla mappa…" : "Scegli sulla mappa"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
                Lat
                <input
                  value={latStr}
                  onChange={(e) => setLatStr(e.target.value)}
                  className={inputCls}
                  placeholder="40.123"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
                Lng
                <input
                  value={lngStr}
                  onChange={(e) => setLngStr(e.target.value)}
                  className={inputCls}
                  placeholder="21.456"
                />
              </label>
            </div>
            {preview?.kind === "ok" && (
              <p className="text-[10px] text-[color:var(--hmr-muted)]">
                Anteprima traccia: ~km {preview.alongKm.toFixed(1)} · scostamento ~{preview.detourM} m
              </p>
            )}
            {preview?.kind === "far" && (
              <p className="text-[10px] text-[color:var(--hmr-warn)]">
                Punto lontano dalla traccia — verifica coordinate.
              </p>
            )}
          </div>
        )}

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Categoria
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PoiCategory)}
            className={inputCls}
          >
            {CATEGORY_ORDER.map((k) => (
              <option key={k} value={k}>
                {CATEGORY_META[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Nome <span className="text-[10px] text-[color:var(--hmr-faint)]">(facoltativo)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[color:var(--hmr-muted)]">
          Note <span className="text-[10px] text-[color:var(--hmr-faint)]">(facoltativo)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="orari, prezzo…"
            className={inputCls}
          />
        </label>

        {error && <p className="text-xs text-[color:var(--hmr-danger)]">{error}</p>}

        <button type="submit" disabled={pending} className="hmr-btn hmr-btn-accent hmr-tap w-full">
          {pending ? "Salvataggio…" : "Salva POI"}
        </button>
      </form>
    </div>
  );
}
