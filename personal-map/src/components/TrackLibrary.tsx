"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { IngestProgressOverlay, type IngestOverlayDone } from "@/components/IngestProgressOverlay";
import type { IngestCreditsInfo } from "@/lib/ingest-credits";

export type TrackLibraryItem = {
  id: string;
  name: string;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  point_count: number;
  activity_type: string | null;
  created_at: number;
};

type Props = {
  tracks: TrackLibraryItem[];
  credits: IngestCreditsInfo;
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function creditsLabel(credits: IngestCreditsInfo): string {
  if (credits.unlimited) return "Upload illimitati";
  const n = credits.creditsRemaining ?? 0;
  return n === 1 ? "1 credito upload" : `${n} crediti upload`;
}

export default function TrackLibrary({ tracks, credits }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [activityType, setActivityType] = useState("");
  const [ingestStartedAt, setIngestStartedAt] = useState<number | null>(null);
  const [ingestPhaseLabel, setIngestPhaseLabel] = useState<string | undefined>();
  const [ingestDone, setIngestDone] = useState<IngestOverlayDone | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const busy = ingestStartedAt != null && ingestDone == null;
  const [trackList, setTrackList] = useState(tracks);
  const [err, setErr] = useState<string | null>(null);
  const [creditsState, setCreditsState] = useState(credits);
  const canUpload = creditsState.canIngest;

  const onDeleteTrack = async (trackId: string, trackName: string) => {
    if (!window.confirm(`Eliminare "${trackName}" (${trackId})?`)) return;
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
      setErr("Credito upload esaurito.");
      return;
    }
    setIngestDone(null);
    setIngestStartedAt(Date.now());
    setIngestPhaseLabel("Caricamento e analisi GPX…");
    setErr(null);

    const trackNameFallback = name.trim() || file.name;

    try {
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      if (activityType.trim()) fd.append("activityType", activityType.trim());

      const importRes = await fetch("/api/tracks/import", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });

      const importData = (await importRes.json().catch(() => ({}))) as {
        error?: string;
        trackId?: string;
        name?: string;
        credits?: IngestCreditsInfo;
      };
      if (!importRes.ok || !importData.trackId) {
        throw new Error(importData.error ?? "Import GPX non riuscito");
      }

      const trackId = importData.trackId;
      const trackName = importData.name ?? trackNameFallback;

      setIngestPhaseLabel("Download POI da OpenStreetMap… (5–15 min, non chiudere)");

      const snapRes = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/snapshot`, {
        method: "POST",
        credentials: "same-origin",
      });

      const snapData = (await snapRes.json().catch(() => ({}))) as {
        error?: string;
        poiCount?: number;
        snapshotComplete?: boolean;
        credits?: IngestCreditsInfo;
      };

      if (snapData.credits) setCreditsState(snapData.credits);

      setIngestStartedAt(null);
      setIngestPhaseLabel(undefined);

      if (!snapRes.ok || !snapData.snapshotComplete) {
        setIngestDone({
          trackId,
          trackName,
          poiCount: snapData.poiCount,
          partial: true,
          warning: snapData.error ?? "Snapshot OpenStreetMap non completato.",
        });
        return;
      }

      setIngestDone({ trackId, trackName, poiCount: snapData.poiCount, partial: false });
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
      setIngestStartedAt(null);
      setIngestPhaseLabel(undefined);
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
        <IngestProgressOverlay mode="running" startedAt={ingestStartedAt} phaseLabel={ingestPhaseLabel} />
      ) : null}
      {ingestDone ? (
        <IngestProgressOverlay mode="done" result={ingestDone} onOpen={openIngestedTrack} />
      ) : null}

      <header className="shrink-0 border-b border-[color:var(--hmr-border)]/60 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Personal Map</h1>
            <p className="mt-1 text-sm text-[color:var(--hmr-muted)]">
              Le tue tracce GPX, senza distrazioni social.
            </p>
            <p className="mt-2 text-xs text-[color:var(--hmr-faint)]">{creditsLabel(creditsState)}</p>
          </div>
          <Link href="/map" className="hmr-btn hmr-btn-accent hmr-tap shrink-0 px-3 text-xs">
            Mappa overview
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-4">
        {trackList.length > 0 ? (
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-[color:var(--hmr-muted)]">
              I tuoi percorsi
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
                      {t.activity_type ? ` · ${t.activity_type}` : ""}
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <dt className="text-[9px] uppercase text-[color:var(--hmr-faint)]">Km</dt>
                      <dd className="font-medium">{t.length_km.toFixed(1)}</dd>
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
                    <button
                      type="button"
                      disabled={deletingId === t.id || busy}
                      onClick={() => void onDeleteTrack(t.id, t.name)}
                      className="rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {deletingId === t.id ? "Elimino…" : "Elimina"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-[color:var(--hmr-muted)]">
            Nessuna traccia ancora. Carica un GPX qui sotto.
          </p>
        )}

        <section className="hmr-panel rounded-2xl border border-[color:var(--hmr-border)]/80 p-4">
          <h2 className="text-sm font-medium">Carica GPX</h2>
          <p className="mt-1 text-xs text-[color:var(--hmr-muted)]">
            Import + snapshot POI OpenStreetMap (5–15 min, non chiudere la pagina).
          </p>
          {!canUpload ? (
            <p className="mt-2 text-xs text-amber-400/90">Credito upload esaurito.</p>
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
              <span className="text-[color:var(--hmr-muted)]">Nome (opzionale)</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Es. Anello del Gran Sasso"
                className="rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[color:var(--hmr-muted)]">Attività (opzionale)</span>
              <select
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
                className="rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-3 py-2 text-sm"
              >
                <option value="">—</option>
                <option value="hiking">Escursionismo</option>
                <option value="mtb">MTB</option>
                <option value="gravel">Gravel</option>
                <option value="road_bike">Bici da corsa</option>
                <option value="running">Corsa</option>
              </select>
            </label>
            {err ? <p className="text-xs text-red-400">{err}</p> : null}
            <button
              type="submit"
              disabled={busy || !canUpload}
              className="rounded-lg bg-[color:var(--hmr-accent)] px-4 py-2.5 text-sm font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
            >
              {busy ? "Import in corso…" : "Importa e analizza"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
