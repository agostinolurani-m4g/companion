"use client";

import { useEffect, useState } from "react";

const RUNNING_PHASES = [
  "Caricamento file GPX…",
  "Analisi traccia e salvataggio…",
  "Download POI da OpenStreetMap…",
  "Classificazione superficie (asfalto / sterrato)…",
] as const;

export type IngestOverlayDone = {
  trackId: string;
  trackName?: string;
  poiCount?: number;
  partial?: boolean;
  warning?: string;
};

type Props =
  | { mode: "running"; startedAt: number }
  | { mode: "done"; result: IngestOverlayDone; onOpen: () => void };

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

export function IngestProgressOverlay(props: Props) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);

  const startedAt = props.mode === "running" ? props.startedAt : 0;

  useEffect(() => {
    if (props.mode !== "running") return;
    const tick = () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [props.mode, startedAt]);

  useEffect(() => {
    if (props.mode !== "running") return;
    setPhaseIdx(0);
    const id = window.setInterval(() => {
      setPhaseIdx((i) => Math.min(i + 1, RUNNING_PHASES.length - 1));
    }, 12_000);
    return () => window.clearInterval(id);
  }, [props.mode, startedAt]);

  if (props.mode === "done") {
    const { result, onOpen } = props;
    const partial = result.partial;
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-[color:var(--hmr-bg)]/85 p-4 backdrop-blur-sm"
        role="alertdialog"
        aria-labelledby="ingest-done-title"
      >
        <div className="hmr-panel w-full max-w-md rounded-2xl border border-[color:var(--hmr-border)] p-6 text-center shadow-2xl">
          <div
            className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
              partial
                ? "border border-amber-500/50 bg-amber-500/15 text-amber-300"
                : "border border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
            }`}
            aria-hidden
          >
            {partial ? "!" : "✓"}
          </div>
          <h2 id="ingest-done-title" className="text-lg font-semibold">
            {partial ? "Traccia salvata" : "Ingestione completata"}
          </h2>
          <p className="mt-2 text-sm text-[color:var(--hmr-muted)]">
            {partial
              ? "Il percorso è nel database. I POI o la superficie OSM potrebbero essere incompleti."
              : "Fatto. Traccia, POI e superficie sono pronti."}
          </p>
          {result.trackName ? (
            <p className="mt-1 text-xs text-[color:var(--hmr-faint)]">{result.trackName}</p>
          ) : null}
          {typeof result.poiCount === "number" ? (
            <p className="mt-2 text-xs text-[color:var(--hmr-muted)]">
              {result.poiCount.toLocaleString("it-IT")} POI in database
            </p>
          ) : null}
          {result.warning ? (
            <p className="mt-3 max-h-24 overflow-y-auto text-left text-[11px] leading-snug text-amber-400/90">
              {result.warning}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onOpen}
            className="mt-5 w-full rounded-lg bg-[color:var(--hmr-accent)] px-4 py-3 text-sm font-medium text-[color:var(--hmr-bg)]"
          >
            Apri gara
          </button>
        </div>
      </div>
    );
  }

  const phase = RUNNING_PHASES[phaseIdx];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[color:var(--hmr-bg)]/88 p-4 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="hmr-panel w-full max-w-md rounded-2xl border border-[color:var(--hmr-accent)]/30 p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="hmr-ingest-spinner shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 text-left">
            <p className="text-sm font-medium text-[color:var(--hmr-text)]">Ingestione in corso</p>
            <p className="mt-2 text-sm text-[color:var(--hmr-accent)]">{phase}</p>
            <p className="mt-3 text-xs text-[color:var(--hmr-muted)]">
              Tempo trascorso: <strong className="text-[color:var(--hmr-text)]">{formatElapsed(elapsedSec)}</strong>
              {" · "}di solito 5–15 min
            </p>
            <p className="mt-2 text-[11px] text-[color:var(--hmr-faint)]">
              Non chiudere questa pagina finché non compare «Ingestione completata».
            </p>
          </div>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[color:var(--hmr-elev)]">
          <div className="hmr-ingest-bar h-full rounded-full bg-[color:var(--hmr-accent)]" />
        </div>
      </div>
    </div>
  );
}
