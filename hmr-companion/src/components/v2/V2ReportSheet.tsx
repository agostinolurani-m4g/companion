"use client";

import { useEffect, useRef, useState } from "react";
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
  photo_url?: string | null;
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
  /** Precompilazione (es. da un'uscita importata): l'utente può cambiare tutto. */
  initialKind?: FieldReportKind;
  initialDescription?: string;
  /** Contesto mostrato sotto il titolo (es. "Dalla tua uscita del 3 nov"). */
  contextLabel?: string;
};

export function V2ReportCreateSheet({
  lng,
  lat,
  onClose,
  onCreated,
  initialKind,
  initialDescription,
  contextLabel,
}: CreateProps) {
  const [kind, setKind] = useState<FieldReportKind>(initialKind ?? "other");
  const [description, setDescription] = useState(initialDescription ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const pickPhoto = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setErr("Foto troppo grande (max 5 MB)");
      return;
    }
    setErr(null);
    setPhoto(f);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      let res: Response;
      if (photo) {
        const fd = new FormData();
        fd.append("lng", String(lng));
        fd.append("lat", String(lat));
        fd.append("kind", kind);
        fd.append("description", description.trim());
        fd.append("file", photo);
        res = await fetch("/api/v2/reports", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/v2/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lng, lat, kind, description: description.trim() }),
        });
      }
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
          {contextLabel ? `${contextLabel} · ` : ""}
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
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(e) => {
            pickPhoto(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {photoPreview ? (
          <div className="mt-2 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview} alt="Anteprima foto" className="h-16 w-16 rounded-lg object-cover" />
            <div className="flex flex-col items-start gap-1 text-xs">
              <button type="button" onClick={() => fileRef.current?.click()} className="text-[color:var(--hmr-accent)]">
                Cambia foto
              </button>
              <button type="button" onClick={() => setPhoto(null)} className="text-[color:var(--hmr-muted)]">
                Rimuovi
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-2 w-full rounded-lg border border-dashed border-[color:var(--hmr-border)] py-2 text-xs text-[color:var(--hmr-muted)]"
          >
            Aggiungi una foto (opzionale)
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-3 w-full rounded-lg bg-[color:var(--hmr-accent)] py-2.5 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
        >
          {busy ? "Invio…" : "Pubblica segnalazione"}
        </button>
        {err ? <p className="mt-2 text-xs text-[color:var(--hmr-danger)]">{err}</p> : null}
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
        {report.photo_url ? (
          <a href={report.photo_url} target="_blank" rel="noreferrer" className="mt-2 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={report.photo_url}
              alt={`Foto della segnalazione: ${report.kind_label}`}
              className="max-h-56 w-full rounded-lg object-cover"
              loading="lazy"
            />
          </a>
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
