"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import {
  formatOutingDate,
  OUTING_STATUS_LABELS,
  outingDays,
  outingNeedsReport,
  summarizeConditions,
  type OutingDto,
} from "@/lib/outings-types";
import { SPORTS } from "@/lib/sports";

type Props = {
  routeId: string;
  /** Link al planner con la tab Gita aperta su questo percorso. */
  planHref?: string;
  className?: string;
};

export function outingHref(id: string): string {
  return `/v2/gite/${encodeURIComponent(id)}`;
}

/** Badge stato gita (In programma / Fatta / Resoconto da scrivere). */
export function OutingStatusBadge({ outing }: { outing: Pick<OutingDto, "status" | "outing_date"> }) {
  const needs = outingNeedsReport(outing);
  const label = needs ? "Resoconto da scrivere" : OUTING_STATUS_LABELS[outing.status];
  const cls =
    outing.status === "done"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : needs
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-[color:var(--hmr-accent-dim)] text-[color:var(--hmr-accent)]";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${cls}`}>{label}</span>;
}

type CardsProps = {
  outings: OutingDto[];
  /** Mostra il nome della traccia su ogni gita (liste che mescolano più tracce). */
  showRoute?: boolean;
  emptyText?: string;
};

function OutingCard({ o, showRoute }: { o: OutingDto; showRoute: boolean }) {
  const cond = summarizeConditions(o.conditions);
  const sport = SPORTS[o.activity];
  const days = outingDays(o.stops);
  return (
    <li>
      <Link
        href={outingHref(o.id)}
        className="hmr-panel block rounded-xl border border-[color:var(--hmr-border)]/60 px-3 py-2.5 hover:border-[color:var(--hmr-accent)]/60"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{o.title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[color:var(--hmr-muted)]">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: sport.color }} aria-hidden />
                {sport.shortLabel}
              </span>
              · {formatOutingDate(o.outing_date)}
              {o.start_time ? ` · ${o.start_time}` : ""}
              {days > 1 ? ` · ${days} giorni` : ""}
              {o.participants.length > 1 ? ` · ${o.participants.length} persone` : ""}
              {o.photos.length ? ` · ${o.photos.length} foto` : ""}
            </span>
          </span>
          <OutingStatusBadge outing={o} />
        </div>
        {showRoute && o.route_name ? (
          <p className="mt-1 truncate text-xs text-[color:var(--hmr-faint)]">Traccia: {o.route_name}</p>
        ) : null}
        {cond || o.story ? <p className="mt-1 line-clamp-2 text-xs text-[color:var(--hmr-muted)]">{cond || o.story}</p> : null}
      </Link>
    </li>
  );
}

/**
 * Elenco di gite diviso in "In programma" (dalla più vicina) e "Fatte" (dalla più recente).
 * Ogni gita apre il suo dettaglio, non la traccia.
 */
export function OutingCardList({ outings, showRoute = true, emptyText = "Nessuna gita." }: CardsProps) {
  if (outings.length === 0) return <p className="text-sm text-[color:var(--hmr-muted)]">{emptyText}</p>;
  const planned = outings
    .filter((o) => o.status === "planned")
    .sort((a, b) => (a.outing_date ?? "9999").localeCompare(b.outing_date ?? "9999"));
  const done = outings
    .filter((o) => o.status === "done")
    .sort((a, b) => (b.outing_date ?? "").localeCompare(a.outing_date ?? ""));
  return (
    <div className="space-y-4">
      {planned.length ? (
        <section>
          <h3 className="ui-eyebrow mb-2">In programma · {planned.length}</h3>
          <ul className="grid gap-2">
            {planned.map((o) => (
              <OutingCard key={o.id} o={o} showRoute={showRoute} />
            ))}
          </ul>
        </section>
      ) : null}
      {done.length ? (
        <section>
          <h3 className="ui-eyebrow mb-2">Fatte · {done.length}</h3>
          <ul className="grid gap-2">
            {done.map((o) => (
              <OutingCard key={o.id} o={o} showRoute={showRoute} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Gite (in programma e fatte) su un percorso. La traccia è riusabile, ogni gita è un'uscita. */
export default function V2OutingList({ routeId, planHref, className = "" }: Props) {
  const [outings, setOutings] = useState<OutingDto[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await fetchJson<{ outings?: OutingDto[] }>(`/api/v2/outings?route_id=${encodeURIComponent(routeId)}`);
      setOutings(data.outings ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setOutings([]);
    } finally {
      setBusy(false);
    }
  }, [routeId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className={`rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)] p-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">Gite su questa traccia</p>
        {planHref ? (
          <Link
            href={planHref}
            className="rounded-lg border border-[color:var(--hmr-accent)]/50 px-2 py-0.5 text-[10px] text-[color:var(--hmr-accent)]"
          >
            + Pianifica gita
          </Link>
        ) : null}
      </div>

      {busy ? (
        <p className="mt-2 text-xs text-[color:var(--hmr-muted)]">Carico gite…</p>
      ) : outings.length === 0 ? (
        <p className="mt-2 text-xs text-[color:var(--hmr-muted)]">Nessuna gita ancora.</p>
      ) : (
        <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
          {outings.map((o) => {
            const cond = summarizeConditions(o.conditions);
            return (
              <li key={o.id}>
                <Link
                  href={outingHref(o.id)}
                  className="block rounded-lg border border-[color:var(--hmr-border)]/50 bg-[color:var(--hmr-bg)]/40 px-2 py-1.5 hover:border-[color:var(--hmr-accent)]/50"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium">{o.title}</span>
                    <OutingStatusBadge outing={o} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-[color:var(--hmr-muted)]">
                    {formatOutingDate(o.outing_date)}
                    {o.participants.length > 1 ? ` · ${o.participants.length} persone` : ""}
                    {o.photos.length ? ` · ${o.photos.length} foto` : ""}
                  </p>
                  {cond || o.story ? (
                    <p className="mt-0.5 line-clamp-2 text-[10px] text-[color:var(--hmr-faint)]">{cond || o.story}</p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {err ? <p className="mt-2 text-xs text-[color:var(--hmr-danger)]">{err}</p> : null}
    </section>
  );
}
