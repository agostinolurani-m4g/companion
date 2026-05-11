"use client";

import { useEffect, useState } from "react";
import type { CheckpointRow } from "@/lib/db";
import {
  DEFAULT_PACE,
  computeEta,
  formatHours,
  formatRelative,
  loadPace,
  savePace,
  type PaceConfig,
} from "@/lib/pace";
import type { StoredCoord } from "@/lib/track-coords";

export type CheckpointsPanelProps = {
  checkpoints: CheckpointRow[];
  coords: StoredCoord[];
  atKm: number | null;
};

export default function CheckpointsPanel({ checkpoints, coords, atKm }: CheckpointsPanelProps) {
  const [pace, setPace] = useState<PaceConfig>(DEFAULT_PACE);
  /** 0 fino al mount: evita mismatch SSR (Date.now diverso server/client). */
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setPace(loadPace());
  }, []);

  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const updatePace = (patch: Partial<PaceConfig>) => {
    const next = { ...pace, ...patch };
    setPace(next);
    savePace(next);
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="hmr-panel flex flex-col gap-2 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
          Pace bici (3 terreni)
        </h3>
        <PaceSlider label="Asfalto / dolce" unit="km/h" value={pace.tarmacKmh} min={8} max={38} step={1}
          onChange={(v) => updatePace({ tarmacKmh: v })} />
        <PaceSlider label="Sterrato rideable" unit="km/h" value={pace.gravelKmh} min={4} max={25} step={0.5}
          onChange={(v) => updatePace({ gravelKmh: v })} />
        <PaceSlider label="Hike-a-bike" unit="km/h" value={pace.hikeKmh} min={1.5} max={7} step={0.1}
          onChange={(v) => updatePace({ hikeKmh: v })} />
        <PaceSlider label="Fatica (penalty)" unit="×" value={pace.fatigueMult} min={0.8} max={1.8} step={0.05}
          onChange={(v) => updatePace({ fatigueMult: v })} />
        <p className="text-xs text-[color:var(--hmr-muted)]">
          Le soglie sono stimate dalla pendenza media del singolo segmento semplificato. Salvato su questo dispositivo.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
          ETA checkpoint dalla tua posizione
        </h3>
        {atKm == null && (
          <div className="hmr-panel p-3 text-xs text-[color:var(--hmr-muted)]">
            Imposta prima la tua posizione (Dashboard) per avere gli ETA.
          </div>
        )}
        <div className="hmr-panel divide-y divide-[color:var(--hmr-border)]/60 overflow-hidden">
          {checkpoints.map((cp) => (
            <CheckpointRowView
              key={cp.id}
              cp={cp}
              coords={coords}
              atKm={atKm}
              pace={pace}
              nowMs={nowMs}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PaceSlider({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[color:var(--hmr-muted)]">
      <span className="w-32 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[color:var(--hmr-accent)]"
      />
      <span className="w-16 text-right text-[color:var(--hmr-text)]">
        {value.toFixed(step < 1 ? 2 : 0)} {unit}
      </span>
    </label>
  );
}

function CheckpointRowView({
  cp,
  coords,
  atKm,
  pace,
  nowMs,
}: {
  cp: CheckpointRow;
  coords: StoredCoord[];
  atKm: number | null;
  pace: PaceConfig;
  nowMs: number;
}) {
  const passed = atKm != null && atKm > cp.along_km + 0.3;
  const eta =
    atKm != null && !passed && nowMs > 0
      ? computeEta(coords, atKm, cp.along_km, pace, cp.cutoff_utc, nowMs)
      : null;

  const badge = (() => {
    if (passed) return { tone: "done", label: "superato" };
    if (!eta) return { tone: "idle", label: "—" };
    if (eta.cutoffStatus === "green") return { tone: "green", label: "OK" };
    if (eta.cutoffStatus === "yellow") return { tone: "yellow", label: "tight" };
    if (eta.cutoffStatus === "red") return { tone: "red", label: "RISCHIO" };
    return { tone: "idle", label: "—" };
  })();

  const badgeColors: Record<string, string> = {
    green: "bg-emerald-500/20 text-emerald-300 border-emerald-400/40",
    yellow: "bg-amber-500/20 text-amber-300 border-amber-400/40",
    red: "bg-rose-500/20 text-rose-300 border-rose-400/40",
    done: "bg-slate-600/30 text-slate-200 border-slate-400/30",
    idle: "bg-slate-700/30 text-slate-300 border-slate-500/30",
  };

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{cp.name}</span>
          <span className="truncate text-xs text-[color:var(--hmr-muted)]">
            {cp.label ?? ""} · km {cp.along_km.toFixed(1)}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeColors[badge.tone]}`}
        >
          {badge.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-[color:var(--hmr-muted)]">
        <StatBlock label="Cutoff">
          {cp.cutoff_utc ? formatAbsolute(cp.cutoff_utc) : "—"}
        </StatBlock>
        <StatBlock label="ETA">
          {eta ? formatAbsolute(eta.etaMs) : passed ? "OK" : "—"}
        </StatBlock>
        <StatBlock label={passed ? "Distanza" : "Tempo stimato"}>
          {passed
            ? `${(cp.along_km - (atKm ?? 0)).toFixed(1)} km`
            : eta
              ? formatHours(eta.remainingHours)
              : "—"}
        </StatBlock>
      </div>
      {eta && cp.cutoff_utc && !passed && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-[color:var(--hmr-muted)]">
            Margine cutoff: {formatHours(eta.marginHours)}
          </span>
          <span className="text-[color:var(--hmr-muted)]">
            Cutoff fra {formatRelative(cp.cutoff_utc, nowMs)}
          </span>
        </div>
      )}
    </div>
  );
}

function StatBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-[color:var(--hmr-faint)]">
        {label}
      </span>
      <span className="text-[13px] font-medium text-[color:var(--hmr-text)]">{children}</span>
    </div>
  );
}

function formatAbsolute(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
    timeZone: "Europe/Athens",
  });
  const time = d.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Athens",
  });
  return `${date} ${time}`;
}
