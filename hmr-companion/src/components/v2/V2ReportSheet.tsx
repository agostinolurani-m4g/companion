"use client";

import { useState } from "react";
import type { FieldReportKind } from "@/lib/field-reports";
import { REPORT_KIND_LABELS } from "@/lib/field-reports";

type ReportDto = {
  id: string;
  author: string;
  kind: FieldReportKind;
  kind_label: string;
  description: string;
  confirmation_count: number;
  verified: boolean;
  status: string;
  viewer_confirmed?: boolean;
};

type Props = {
  report: ReportDto | null;
  isSelf: boolean;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
  onResolve: (id: string) => Promise<void>;
};

const KINDS = Object.entries(REPORT_KIND_LABELS) as [FieldReportKind, string][];

type CreateProps = {
  lng: number;
  lat: number;
  onClose: () => void;
  onCreated: () => void;
};

export function V2ReportCreateSheet({ lng, lat, onClose, onCreated }: CreateProps) {
  const [kind, setKind] = useState<FieldReportKind>("other");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/v2/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lng, lat, kind, description: description.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Invio fallito");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-t-2xl border border-[color:var(--hmr-border)] bg-[color:var(--hmr-panel)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Nuova segnalazione</h2>
          <button type="button" onClick={onClose} className="text-xs text-[color:var(--hmr-muted)]">
            Chiudi
          </button>
        </div>
        <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          {KINDS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={
                kind === k
                  ? "rounded-full bg-[color:var(--hmr-accent)] px-2 py-0.5 text-[10px] text-[color:var(--hmr-bg)]"
                  : "rounded-full border border-[color:var(--hmr-border)] px-2 py-0.5 text-[10px]"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrizione breve (opzionale)"
          rows={2}
          className="mt-3 w-full rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-3 w-full rounded-lg bg-[color:var(--hmr-accent)] py-2.5 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
        >
          {busy ? "Invio…" : "Pubblica segnalazione"}
        </button>
        {err ? <p className="mt-2 text-xs text-red-400">{err}</p> : null}
      </div>
    </div>
  );
}

export default function V2ReportSheet({
  report,
  isSelf,
  onClose,
  onConfirm,
  onResolve,
}: Props) {
  const [busy, setBusy] = useState(false);
  if (!report) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-t-2xl border border-[color:var(--hmr-border)] bg-[color:var(--hmr-panel)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{report.kind_label}</h2>
          <button type="button" onClick={onClose} className="text-xs text-[color:var(--hmr-muted)]">
            Chiudi
          </button>
        </div>
        <p className="mt-1 text-xs text-[color:var(--hmr-muted)]">di @{report.author}</p>
        {report.description ? (
          <p className="mt-2 text-sm">{report.description}</p>
        ) : null}
        <p className="mt-2 text-[10px] text-[color:var(--hmr-muted)]">
          {report.verified
            ? "Verificata dalla community"
            : `${report.confirmation_count} conferme`}
        </p>
        <div className="mt-4 flex gap-2">
          {!isSelf && report.status === "active" && !report.viewer_confirmed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onConfirm(report.id).finally(() => setBusy(false));
              }}
              className="flex-1 rounded-lg bg-[color:var(--hmr-accent)] py-2 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
            >
              Confermo
            </button>
          ) : null}
          {report.status === "active" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onResolve(report.id).finally(() => setBusy(false));
              }}
              className="flex-1 rounded-lg border border-[color:var(--hmr-border)] py-2 text-xs"
            >
              Non c&apos;è più
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
