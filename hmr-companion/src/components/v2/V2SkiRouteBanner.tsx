"use client";

import type { RouteFacts } from "@/lib/route-facts";
import { ROUTE_SHAPE_LABEL } from "@/lib/route-shape";

type Props = {
  name: string;
  lengthKm: number;
  elevGainM?: number;
  elevLossM?: number;
  owner?: string;
  source?: string | null;
  sourceUrl?: string | null;
  license?: string | null;
  /** Fatti normalizzati (difficoltà, tempo, testo…): opzionali, la scheda funziona anche senza. */
  facts?: RouteFacts | null;
  /** Confronto esposizioni percorso ↔ bollettino valanghe (solo sci). */
  avalancheNote?: { status: string; text: string } | null;
  onOpen?: () => void;
  onRegisterOuting?: () => void;
  onDismiss?: () => void;
};

const SOURCE_LABELS: Record<string, string> = {
  camptocamp: "camptocamp.org",
  gulliver: "Gulliver",
  user: "Utente",
};

export default function V2SkiRouteBanner({
  name,
  lengthKm,
  elevGainM,
  elevLossM,
  owner,
  source,
  sourceUrl,
  license,
  facts,
  avalancheNote,
  onOpen,
  onRegisterOuting,
  onDismiss,
}: Props) {
  const text = facts?.summary ?? facts?.description ?? null;
  const generated = !facts?.summary && !!facts?.description?.generated;
  const wm = facts?.waymark;
  return (
    <div className="ui-glass v2-anim-in pointer-events-auto relative w-full rounded-lg p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-white">{name}</h2>
          <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-[color:var(--hmr-muted)]">
            <span>{lengthKm.toFixed(1)} km</span>
            {elevGainM != null && elevGainM > 0 ? <span>D+ {Math.round(elevGainM)} m</span> : null}
            {elevLossM != null && elevLossM > 0 ? <span>D− {Math.round(elevLossM)} m</span> : null}
            {facts?.durationLabel ? <span title="Tempo in movimento stimato, senza soste">≈ {facts.durationLabel}</span> : null}
            {facts?.daysLabel ? <span>· {facts.daysLabel}</span> : null}
            {facts?.elevation.max != null ? (
              <span title={facts.elevation.source === "dem" ? "Quota dal modello del terreno" : undefined}>
                max {Math.round(facts.elevation.max)} m
              </span>
            ) : null}
            {facts?.routeType ? <span>· {ROUTE_SHAPE_LABEL[facts.routeType]}</span> : null}
            {owner ? <span>· {owner}</span> : null}
          </p>
          {facts && (facts.difficulty.length > 0 || facts.orientations.length > 0 || wm || facts.from || facts.to) ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
              {facts.difficulty.map((d) => (
                <span
                  key={`${d.scale}-${d.value}`}
                  title={`${d.scaleName}: ${d.label}. ${d.explanation}`}
                  className="rounded-full bg-white/10 px-2 py-0.5 text-white"
                >
                  {d.value} · {d.label}
                </span>
              ))}
              {facts.orientations.length ? (
                <span className="text-[color:var(--hmr-muted)]">Esposizione {facts.orientations.join(", ")}</span>
              ) : null}
              {wm?.ref || wm?.operator ? (
                <span className="text-[color:var(--hmr-muted)]">
                  Segnavia {[wm.ref, wm.operator].filter(Boolean).join(" · ")}
                </span>
              ) : null}
              {facts.from || facts.to ? (
                <span className="text-[color:var(--hmr-muted)]">
                  {facts.from ?? "…"} → {facts.to ?? "…"}
                </span>
              ) : null}
            </div>
          ) : null}
          {text ? (
            <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-[11px] text-[color:var(--hmr-muted)]" title={text.text}>
              {text.text}
              {text.lang && text.lang !== "it" ? <span className="ml-1 uppercase">({text.lang})</span> : null}
            </p>
          ) : null}
          {avalancheNote?.text ? (
            <p
              className={`mt-1 text-[10px] ${avalancheNote.status === "match" ? "text-[color:var(--hmr-warn)]" : "text-[color:var(--hmr-muted)]"}`}
            >
              {avalancheNote.text}
            </p>
          ) : null}
          {generated ? (
            <p className="mt-0.5 text-[10px] italic text-[color:var(--hmr-muted)]">Testo generato automaticamente dai dati del percorso.</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {source ? (
              <span className="rounded-full bg-[color:var(--hmr-accent-2)]/15 px-2 py-0.5 text-[10px] text-[color:var(--hmr-accent-2)]">
                {SOURCE_LABELS[source] ?? source}
                {license ? ` · ${license}` : null}
              </span>
            ) : null}
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-[color:var(--hmr-accent-2)] underline"
              >
                Fonte
              </a>
            ) : null}
            <span className="inline-flex items-center gap-2 text-[10px] text-[color:var(--hmr-muted)]">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#22c55e]" />
                Partenza
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#eab308]" />
                Vetta
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" />
                Arrivo
              </span>
            </span>
          </div>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-[color:var(--hmr-muted)] hover:bg-white/10 hover:text-white"
            aria-label="Chiudi"
          >
            ✕
          </button>
        ) : null}
      </div>
      {onOpen || onRegisterOuting ? (
        <div className="mt-2.5 flex gap-2">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="flex-1 rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
            >
              Apri percorso
            </button>
          ) : null}
          {onRegisterOuting ? (
            <button
              type="button"
              onClick={onRegisterOuting}
              className="flex-1 rounded-lg border border-[color:var(--hmr-accent)]/60 px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-accent)]"
            >
              Pianifica gita
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
