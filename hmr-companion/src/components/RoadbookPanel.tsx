"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoadbookChunk } from "@/lib/roadbook-chunk";
import { CATEGORY_META } from "@/lib/categories";
import type { PoiCategory } from "@/lib/db";

type RoadbookResponse = {
  schema_version: number;
  track_id: string;
  length_km: number;
  chunk_km: number;
  chunks: RoadbookChunk[];
};

type Props = {
  trackId: string;
  lengthKm: number;
};

function pctBar(label: string, pct: number, color: string) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[10px] text-[color:var(--hmr-muted)]">
        <span>{label}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--hmr-elev)]">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}

export default function RoadbookPanel({ trackId, lengthKm }: Props) {
  const [data, setData] = useState<RoadbookResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/track/${encodeURIComponent(trackId)}/roadbook?full=1&chunkKm=10`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RoadbookResponse>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [trackId]);

  useEffect(() => {
    load();
  }, [load]);

  const exportJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `roadbook-${trackId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copySummary = async () => {
    if (!data?.chunks.length) return;
    const lines = data.chunks.map(
      (c) => `km ${c.km_start.toFixed(0)}–${c.km_end.toFixed(0)}: ${c.one_liner_it}`
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      /* ignore */
    }
  };

  if (loading && !data) {
    return <div className="p-3 text-xs text-[color:var(--hmr-muted)]">Carico roadbook…</div>;
  }
  if (error) {
    return (
      <div className="p-3 text-xs text-[color:var(--hmr-danger)]">
        {error}
        <button type="button" className="hmr-btn ml-2 mt-2 text-xs" onClick={load}>
          Riprova
        </button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[color:var(--hmr-muted)]">
          Roadbook · blocchi {data.chunk_km} km · {lengthKm.toFixed(0)} km totali
        </span>
        <button type="button" className="hmr-btn hmr-tap text-xs" onClick={load}>
          Aggiorna
        </button>
        <button type="button" className="hmr-btn hmr-tap text-xs" onClick={exportJson}>
          Scarica JSON
        </button>
        <button type="button" className="hmr-btn hmr-tap text-xs" onClick={() => void copySummary()}>
          Copia riepilogo
        </button>
      </div>
      <p className="text-[10px] text-[color:var(--hmr-faint)]">
        Percentuali superficie: stima OpenStreetMap. Pendenza: stima da profilo GPX.
      </p>
      <ul className="flex flex-col gap-2">
        {data.chunks.map((c) => (
          <li key={c.chunk_index} className="hmr-panel overflow-hidden">
            <button
              type="button"
              className="flex w-full items-start gap-2 p-3 text-left"
              onClick={() => setExpanded((e) => (e === c.chunk_index ? null : c.chunk_index))}
            >
              <span className="mt-0.5 text-lg font-semibold text-[color:var(--hmr-accent)]">
                {c.km_start.toFixed(0)}–{c.km_end.toFixed(0)} km
              </span>
              <span className="flex-1 text-xs text-[color:var(--hmr-muted)]">{c.one_liner_it}</span>
            </button>
            {expanded === c.chunk_index && (
              <div className="space-y-2 border-t border-[color:var(--hmr-border)]/50 px-3 pb-3 pt-2 text-xs">
                <div className="grid gap-2">
                  {pctBar("Asfalto", c.surface_pct.asphalt, "#94a3b8")}
                  {pctBar("Sterrato", c.surface_pct.gravel, "#ca8a04")}
                  {pctBar("Single", c.surface_pct.single, "#16a34a")}
                  {c.surface_pct.unknown > 5 &&
                    pctBar("Non class.", c.surface_pct.unknown, "#64748b")}
                </div>
                {c.surface_low_confidence && (
                  <p className="text-[color:var(--hmr-warn)]">Superficie: dati OSM incompleti in questo tratto.</p>
                )}
                {(c.elev_min_m != null || c.elev_max_m != null) && (
                  <p>
                    Quota min–max: {c.elev_min_m != null ? `${Math.round(c.elev_min_m)}` : "—"}–
                    {c.elev_max_m != null ? `${Math.round(c.elev_max_m)}` : "—"} m · D+ ~{c.elev_gain_m_approx ?? "—"}{" "}
                    / D- ~{c.elev_loss_m_approx ?? "—"}
                  </p>
                )}
                {c.steep_unpaved && (
                  <p className="text-[color:var(--hmr-warn)]">
                    Tratti ripidi su non-asfalto (≥15% stimato)
                    {c.steep_unpaved_max_grade_pct != null ? ` · fino ~${c.steep_unpaved_max_grade_pct}%` : ""}
                  </p>
                )}
                {c.hike_a_bike_hint && <p className="text-[color:var(--hmr-warn)]">Hike-a-bike / tratto duro segnalato.</p>}
                {(c.has_checkpoint || c.has_official_resupply) && (
                  <p>
                    {c.has_checkpoint && <>CP: {c.checkpoint_names.join(", ")}. </>}
                    {c.has_official_resupply && <>Resupply: {c.resupply_names.join(", ")}.</>}
                  </p>
                )}
                {c.race_plan_notes && (
                  <p className="text-[color:var(--hmr-faint)]">Piano: {c.race_plan_notes}</p>
                )}
                {c.poi_highlights.length > 0 && (
                  <ul className="list-inside list-disc text-[color:var(--hmr-muted)]">
                    {c.poi_highlights.map((p) => (
                      <li key={`${p.along_km}-${p.category}`}>
                        {CATEGORY_META[p.category as PoiCategory]?.label}:{" "}
                        {p.name ?? p.category} · km {p.along_km.toFixed(1)} · +{p.detour_m} m
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
