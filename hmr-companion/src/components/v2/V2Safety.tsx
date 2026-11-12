"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { FIELD_REPORT_KINDS, REPORT_KIND_LABELS, type FieldReportKind } from "@/lib/field-reports";
import { fetchJson } from "@/lib/fetch-json";
import Icon from "@/components/v2/ui/Icon";
import {
  AVALANCHE_DANGER_SCALE,
  AVALANCHE_SCALE_NOTE,
  CALL_SCRIPT,
  checklistForSport,
  EMERGENCY_NUMBERS,
  RESCUE_TIPS,
  SAFETY_SOURCES,
} from "@/lib/content/safety";
import { AVALANCHE_LEGEND } from "@/lib/ski-overlays";
import { PLANNER_ACTIVITIES, SPORTS, type UserRouteActivity } from "@/lib/sports";

type Props = {
  isAdmin?: boolean;
  username?: string;
};

type ReportRow = {
  id: string;
  kind: FieldReportKind;
  kind_label: string;
  description: string;
  status: string;
  verified: boolean;
  confirmation_count: number;
  created_at: number;
};

type Fix = { lat: number; lng: number; acc: number; alt: number | null };

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h fa`;
  const d = Math.round(h / 24);
  return d === 1 ? "ieri" : `${d} giorni fa`;
}

/** Coordinate in gradi/primi/secondi (formato richiesto spesso dal soccorso). */
function toDms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${d}°${m}′${s}″${v >= 0 ? pos : neg}`;
}

function EmergencyCard() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [state, setState] = useState<"idle" | "locating" | "error">("idle");
  const [copied, setCopied] = useState(false);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setState("error");
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), alt: p.coords.altitude });
        setState("idle");
      },
      () => setState("error"),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 },
    );
  };

  const text = fix
    ? `Posizione: ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} (${toDms(fix.lat, "N", "S")} ${toDms(fix.lng, "E", "W")})` +
      `${fix.alt != null ? ` · quota ${Math.round(fix.alt)} m` : ""} · precisione ±${fix.acc} m`
    : "";

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard non disponibile */
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-[color:var(--hmr-border)] border-l-4 border-l-[color:var(--hmr-accent)] bg-[color:var(--hmr-surface)]">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Emergenza in montagna</p>
          <p className="text-[13px] text-[color:var(--hmr-muted)]">
            Numero unico europeo 112: chiedi del Soccorso Alpino e comunica la tua posizione.
          </p>
        </div>
        <a href="tel:112" className="ui-btn !border-[color:var(--hmr-accent)] !bg-[color:var(--hmr-accent)] !text-white">
          Chiama 112
        </a>
      </div>
      <div className="border-t border-[color:var(--hmr-border)] px-4 py-3">
        {fix ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[14px] font-semibold tabular-nums">
                {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
              </p>
              <p className="text-[11.5px] text-[color:var(--hmr-muted)]">
                {toDms(fix.lat, "N", "S")} {toDms(fix.lng, "E", "W")}
                {fix.alt != null ? ` · ${Math.round(fix.alt)} m` : ""} · ±{fix.acc} m
              </p>
            </div>
            <button type="button" onClick={() => void copy()} className="ui-btn ui-btn-sm">
              {copied ? "Copiata ✓" : "Copia posizione"}
            </button>
            <button type="button" onClick={locate} className="ui-btn ui-btn-sm ui-btn-ghost" aria-label="Aggiorna posizione">
              <Icon name="locate" size={15} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={locate} className="ui-btn ui-btn-sm" disabled={state === "locating"}>
            <Icon name="locate" size={15} className={state === "locating" ? "animate-pulse" : ""} />
            {state === "locating" ? "Rilevo la posizione…" : state === "error" ? "Posizione non disponibile · riprova" : "Mostra le mie coordinate"}
          </button>
        )}
      </div>
    </section>
  );
}

function InfoSection({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="ui-card group p-0" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[15px] font-semibold">
        {title}
        <span className="text-[color:var(--hmr-faint)] transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-[color:var(--hmr-border)] px-4 py-3 text-[13px]">{children}</div>
    </details>
  );
}

function CallGuide() {
  return (
    <InfoSection title="Come chiamare i soccorsi e cosa dire">
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {EMERGENCY_NUMBERS.map((n) => (
          <li key={`${n.number}-${n.where}`} className="flex gap-2.5">
            <a href={`tel:${n.number}`} className="font-mono text-[15px] font-bold text-[color:var(--hmr-accent)]">
              {n.number}
            </a>
            <span className="min-w-0">
              <span className="font-medium">{n.label}</span>
              <span className="text-[color:var(--hmr-muted)]"> · {n.where}</span>
              {n.note ? <span className="block text-[12px] text-[color:var(--hmr-muted)]">{n.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] font-bold uppercase tracking-wide text-[color:var(--hmr-muted)]">Cosa dire</p>
      <ol className="mt-1.5 grid gap-1.5">
        {CALL_SCRIPT.map((c, i) => (
          <li key={c.title} className="flex gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color:var(--hmr-accent-dim)] text-[11px] font-bold text-[color:var(--hmr-accent)]">
              {i + 1}
            </span>
            <span>
              <b>{c.title}.</b> <span className="text-[color:var(--hmr-muted)]">{c.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[12px] font-bold uppercase tracking-wide text-[color:var(--hmr-muted)]">Da sapere</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[color:var(--hmr-muted)]">
        {RESCUE_TIPS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </InfoSection>
  );
}

const CHECKLIST_SPORTS: UserRouteActivity[] = ["ski", ...PLANNER_ACTIVITIES];

function GearChecklist() {
  const [sport, setSport] = useState<UserRouteActivity>("hike");
  const groups = checklistForSport(sport);
  return (
    <InfoSection title="Checklist materiale">
      <div className="ui-no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {CHECKLIST_SPORTS.map((id) => (
          <button key={id} type="button" className="ui-chip" aria-pressed={sport === id} onClick={() => setSport(id)}>
            {SPORTS[id].shortLabel}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.id}>
            <p className="text-[12px] font-bold uppercase tracking-wide text-[color:var(--hmr-muted)]">{g.title}</p>
            <ul className="mt-1 space-y-1">
              {g.items.map((it) => (
                <li key={it} className="flex gap-2">
                  <span className="text-[color:var(--hmr-accent)]">✓</span>
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </InfoSection>
  );
}

function DangerScale() {
  return (
    <InfoSection title="Scala europea del pericolo valanghe">
      <ul className="grid gap-2">
        {AVALANCHE_DANGER_SCALE.map((d) => {
          const color = AVALANCHE_LEGEND.find((l) => l.level === d.level)?.color ?? "transparent";
          return (
            <li key={d.level} className="flex gap-3">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-black/20 text-[14px] font-bold text-white"
                style={{ background: color }}
              >
                {d.level}
              </span>
              <span className="min-w-0">
                <b>{d.name}</b>
                <span className="block text-[12.5px] text-[color:var(--hmr-muted)]">
                  {d.snowpack} {d.triggering}
                </span>
                <span className="block text-[12.5px]">{d.advice}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[12px] text-[color:var(--hmr-muted)]">{AVALANCHE_SCALE_NOTE}</p>
    </InfoSection>
  );
}

function SafetyInfo() {
  return (
    <div className="mt-4 grid gap-2">
      <CallGuide />
      <GearChecklist />
      <DangerScale />
      <p className="text-[11.5px] text-[color:var(--hmr-faint)]">
        Indicazioni generali, non sostituiscono formazione e bollettini ufficiali. Fonti:{" "}
        {SAFETY_SOURCES.map((src, i) => (
          <span key={src.url}>
            {i > 0 ? " · " : ""}
            <a href={src.url} target="_blank" rel="noreferrer" className="underline">
              {src.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}

export default function V2Safety(_props: Props) {
  const [mine, setMine] = useState<ReportRow[]>([]);
  const [kindFilter, setKindFilter] = useState<FieldReportKind | "all">("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ reports: ReportRow[] }>("/api/v2/reports");
      setMine(data.reports);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = mine.filter((r) => kindFilter === "all" || r.kind === kindFilter);
  const kindsPresent = new Set(mine.map((r) => r.kind));

  return (
    <div className="v2-page">
      <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6 lg:pt-10">
        <p className="ui-eyebrow">Sicurezza</p>
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">In montagna, informati</h1>
        <p className="mt-1 text-[14px] text-[color:var(--hmr-muted)]">
          Segnalazioni della community con scadenza e conferme. Segnala pericoli direttamente dalla mappa.
        </p>

        <div className="mt-6">
          <EmergencyCard />
        </div>

        <SafetyInfo />

        <div className="mt-8 flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-bold">Le tue segnalazioni</h2>
          <Link href="/v2/plan?mode=explore" className="ui-btn ui-btn-sm">
            <Icon name="alert" size={15} />
            Segnala sulla mappa
          </Link>
        </div>

        <div className="ui-no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <button type="button" onClick={() => setKindFilter("all")} aria-pressed={kindFilter === "all"} className="ui-chip">
            Tutte {mine.length ? `· ${mine.length}` : ""}
          </button>
          {FIELD_REPORT_KINDS.filter((k) => kindsPresent.has(k) || mine.length === 0).slice(0, 12).map((k) => (
            <button key={k} type="button" onClick={() => setKindFilter(k)} aria-pressed={kindFilter === k} className="ui-chip">
              {REPORT_KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-4 grid gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-[color:var(--hmr-elev)]/70" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-lg border border-dashed border-[color:var(--hmr-border)] px-6 py-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[color:var(--hmr-accent-dim)] text-[color:var(--hmr-accent)]">
              <Icon name="shield" size={24} />
            </span>
            <p className="mt-3 text-[15px] font-semibold">Nessuna segnalazione</p>
            <p className="mt-1 max-w-sm text-[13px] text-[color:var(--hmr-muted)]">
              Hai visto un sentiero franato, ghiaccio o un ponte crollato? In Esplora tocca «Segnala pericolo» e poi il punto sulla
              mappa.
            </p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-2">
            {visible.map((r) => (
              <li key={r.id} className="ui-card flex gap-3 p-3.5">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                    r.status === "active" ? "bg-[color:var(--hmr-warn)]/10 text-[color:var(--hmr-warn)]" : "bg-[color:var(--hmr-elev)] text-[color:var(--hmr-faint)]"
                  }`}
                >
                  <Icon name="alert" size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-semibold">{r.kind_label}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${
                        r.status === "active"
                          ? "bg-[color:var(--hmr-warn)]/10 text-[color:var(--hmr-warn)]"
                          : "bg-[color:var(--hmr-elev)] text-[color:var(--hmr-muted)]"
                      }`}
                    >
                      {r.status === "active" ? "Attiva" : r.status === "resolved" ? "Risolta" : r.status}
                    </span>
                  </div>
                  {r.description ? <p className="mt-0.5 text-[13px] text-[color:var(--hmr-muted)]">{r.description}</p> : null}
                  <p className="mt-1 text-[11.5px] text-[color:var(--hmr-faint)]">
                    {relTime(r.created_at)} · {r.verified ? "✓ Verificata" : `${r.confirmation_count} conferme`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
