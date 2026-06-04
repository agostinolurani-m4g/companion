"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { IngestProgressOverlay, type IngestOverlayDone } from "@/components/IngestProgressOverlay";
import type { IngestCreditsInfo } from "@/lib/ingest-credits";

export type TrackPickerItem = {
  id: string;
  name: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  point_count: number;
  created_at: number;
};

type Props = {
  tracks: TrackPickerItem[];
  credits: IngestCreditsInfo;
  isAdmin?: boolean;
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function creditsLabel(credits: IngestCreditsInfo): string {
  if (credits.unlimited) return "Ingest illimitati";
  const n = credits.creditsRemaining ?? 0;
  return n === 1 ? "1 credito ingest" : `${n} crediti ingest`;
}

export default function TrackPicker({ tracks, credits, isAdmin = false }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [hmrOfficial, setHmrOfficial] = useState(false);
  const [ingestStartedAt, setIngestStartedAt] = useState<number | null>(null);
  const [ingestDone, setIngestDone] = useState<IngestOverlayDone | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const busy = ingestStartedAt != null && ingestDone == null;
  const [trackList, setTrackList] = useState(tracks);
  const [err, setErr] = useState<string | null>(null);
  const [cliOpen, setCliOpen] = useState(false);
  const [creditsState, setCreditsState] = useState(credits);
  const canUpload = creditsState.canIngest;

  const onDeleteTrack = async (trackId: string, trackName: string) => {
    if (
      !window.confirm(
        `Eliminare "${trackName}" (${trackId})?\n\nVerranno rimossi POI, piani gara e tutti i dati collegati.`
      )
    ) {
      return;
    }
    setDeletingId(trackId);
    setErr(null);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Eliminazione non riuscita");
      setTrackList((list) => list.filter((t) => t.id !== trackId));
      router.refresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingId(null);
    }
  };

  const onUpload = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr("Seleziona un file .gpx");
      return;
    }
    if (!canUpload) {
      setErr("Credito ingest esaurito.");
      return;
    }
    setIngestDone(null);
    setIngestStartedAt(Date.now());
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      if (hmrOfficial) fd.append("hmrOfficial", "1");

      const res = await fetch("/api/tracks/import", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        trackId?: string;
        name?: string;
        credits?: IngestCreditsInfo;
        snapshotComplete?: boolean;
        snapshotWarning?: string;
        poiCount?: number;
      };
      if (!res.ok || !data.trackId) {
        throw new Error(data.error ?? "Import non riuscito");
      }
      if (data.credits) setCreditsState(data.credits);
      setIngestStartedAt(null);
      setIngestDone({
        trackId: data.trackId,
        trackName: data.name ?? name.trim() || file.name,
        poiCount: data.poiCount,
        partial: !data.snapshotComplete,
        warning: data.snapshotWarning,
      });
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
      setIngestStartedAt(null);
      setIngestDone(null);
    }
  };

  const openIngestedTrack = () => {
    if (!ingestDone) return;
    const id = ingestDone.trackId;
    setIngestDone(null);
    router.push(`/track/${encodeURIComponent(id)}`);
    router.refresh();
  };

  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-y-auto">
      {ingestStartedAt != null ? (
        <IngestProgressOverlay mode="running" startedAt={ingestStartedAt} />
      ) : null}
      {ingestDone ? (
        <IngestProgressOverlay mode="done" result={ingestDone} onOpen={openIngestedTrack} />
      ) : null}
      <header className="shrink-0 border-b border-[color:var(--hmr-border)]/60 px-4 py-4">
        <h1 className="text-xl font-semibold">HMR Companion</h1>
        <p className="mt-1 text-sm text-[color:var(--hmr-muted)]">
          Scegli una gara o carica un GPX: traccia, POI OpenStreetMap e superficie vengono creati in
          automatico (non serve terminale).
        </p>
        <p className="mt-2 text-xs text-[color:var(--hmr-faint)]">
          {creditsLabel(creditsState)}
          {creditsState.unlimited ? null : (
            <span className="text-[color:var(--hmr-muted)]"> · 1 upload = traccia + POI + superficie</span>
          )}
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-4">
        {trackList.length > 0 ? (
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-[color:var(--hmr-muted)]">
              Gare nel database
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {trackList.map((t) => (
                <li
                  key={t.id}
                  className="hmr-panel flex flex-col gap-3 rounded-2xl border border-[color:var(--hmr-border)]/80 p-4"
                >
                  <div>
                    <h3 className="font-medium leading-snug">{t.name}</h3>
                    <p className="mt-0.5 text-[10px] text-[color:var(--hmr-faint)]">
                      {t.id} · {formatDate(t.created_at)}
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <dt className="text-[9px] uppercase text-[color:var(--hmr-faint)]">Km</dt>
                      <dd className="font-medium">{t.length_km.toFixed(0)}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] uppercase text-[color:var(--hmr-faint)]">D+</dt>
                      <dd className="font-medium">{Math.round(t.elev_gain_m)} m</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] uppercase text-[color:var(--hmr-faint)]">Vertici</dt>
                      <dd className="font-medium">{t.point_count}</dd>
                    </div>
                  </dl>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Link
                      href={`/track/${encodeURIComponent(t.id)}`}
                      className="rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
                    >
                      Apri
                    </Link>
                    <a
                      href={`/api/track/${encodeURIComponent(t.id)}/gpx`}
                      className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs text-[color:var(--hmr-muted)] hover:text-[color:var(--hmr-text)]"
                    >
                      Scarica GPX
                    </a>
                    {isAdmin ? (
                      <button
                        type="button"
                        disabled={deletingId === t.id || busy}
                        onClick={() => void onDeleteTrack(t.id, t.name)}
                        className="rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {deletingId === t.id ? "Elimino…" : "Elimina"}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-[color:var(--hmr-muted)]">
            Nessuna gara in database. Importa un GPX qui sotto o usa la CLI.
          </p>
        )}

        <section className="hmr-panel rounded-2xl border border-[color:var(--hmr-border)]/80 p-4">
          <h2 className="text-sm font-medium">Carica GPX</h2>
          <p className="mt-1 text-xs text-[color:var(--hmr-muted)]">
            L&apos;app scarica da sola i POI da OpenStreetMap e la superficie del percorso (come{" "}
            <code className="rounded bg-[color:var(--hmr-elev)] px-1">npm run snapshot</code>).
            Serve rete e circa 5–15 minuti: non chiudere la pagina.
          </p>
          {!canUpload ? (
            <p className="mt-2 text-xs text-amber-400/90">
              Credito ingest esaurito. Puoi ancora aprire le gare già presenti.
            </p>
          ) : null}
          <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => void onUpload(e)}>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[color:var(--hmr-muted)]">File .gpx</span>
              <input
                ref={fileRef}
                type="file"
                accept=".gpx,application/gpx+xml"
                className="text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-[color:var(--hmr-elev)] file:px-3 file:py-1.5 file:text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[color:var(--hmr-muted)]">Nome gara (opzionale)</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Es. Trail dei Monti 2026"
                className="rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-3 py-2 text-sm"
              />
            </label>
            <label className="flex items-start gap-2 text-xs text-[color:var(--hmr-muted)]">
              <input
                type="checkbox"
                checked={hmrOfficial}
                onChange={(e) => setHmrOfficial(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Aggiorna <strong className="text-[color:var(--hmr-text)]">HMR 2026</strong> (checkpoint e
                resupply ufficiali dal manuale)
              </span>
            </label>
            {err ? <p className="text-xs text-red-400">{err}</p> : null}
            <button
              type="submit"
              disabled={busy || !canUpload}
              className="rounded-lg bg-[color:var(--hmr-accent)] px-4 py-2.5 text-sm font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
            >
              {busy ? "Ingestione in corso…" : "Ingest completo e apri"}
            </button>
          </form>
        </section>

        <section className="text-xs text-[color:var(--hmr-faint)]">
          <button
            type="button"
            className="text-[color:var(--hmr-muted)] underline"
            onClick={() => setCliOpen((v) => !v)}
          >
            {cliOpen ? "Nascondi" : "Mostra"} istruzioni CLI
          </button>
          {cliOpen ? (
            <pre className="hmr-panel mt-2 whitespace-pre-wrap rounded-xl p-3 text-left">
              {`# Opzionale: solo da terminale (stesso risultato dell'upload web)
cd hmr-companion
npm run ingest
TRACK_ID=mia-gara npm run snapshot
TRACK_ID=mia-gara npm run snapshot:surface`}
            </pre>
          ) : null}
        </section>
      </div>
    </main>
  );
}
