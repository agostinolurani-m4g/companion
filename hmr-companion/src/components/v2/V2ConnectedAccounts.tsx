"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import V2PhotoCapture from "@/components/v2/V2PhotoCapture";
import { V2ReportCreateSheet } from "@/components/v2/V2ReportSheet";
import type { FieldReportKind } from "@/lib/field-reports";
import { activityLabel, isUserRouteActivity, isWinterSport, PLANNER_ACTIVITIES } from "@/lib/sports";

type IntegrationsStatus = {
  strava: {
    configured: boolean;
    connected: boolean;
    athlete_name: string | null;
    status: "active" | "revoked" | "error" | null;
    last_sync_at: number | null;
    last_error: string | null;
    syncing: boolean;
    activities: number;
  };
  uploads: { activities: number };
};

type ActivityItem = {
  id: string;
  provider: "strava" | "upload" | "app";
  sport: string;
  name: string;
  start_time: number;
  distance_m: number;
  elev_gain_m: number;
  community_consent: boolean;
  in_community_heatmap: boolean;
  high_point: [number, number, number | null];
  end_point: [number, number];
  can_publish: boolean;
};

const STRAVA_ORANGE = "#FC4C02";

const STRAVA_OUTCOME: Record<string, string> = {
  connected: "Strava collegato: sto importando le tue attività dell'ultimo anno.",
  denied: "Collegamento a Strava annullato.",
  invalid_state: "Sessione di collegamento scaduta: riprova.",
  missing_scope: "Serve il permesso di lettura attività: riprova e lascia la spunta.",
  not_configured: "Strava non è configurato sul server (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET).",
  error: "Errore durante il collegamento a Strava.",
};

function sportName(s: string): string {
  return isUserRouteActivity(s) ? activityLabel(s) : s;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
}

function fmtAgo(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h fa`;
  return fmtDate(ms);
}

function suggestedKind(a: ActivityItem): FieldReportKind {
  return isUserRouteActivity(a.sport) && isWinterSport(a.sport) ? "snow_conditions" : "other";
}

/** Card "Collegamenti e import" + "Da rivedere" per l'hub personale. */
export default function V2ConnectedAccounts() {
  const [status, setStatus] = useState<IntegrationsStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<ActivityItem[]>([]);
  const [uploadSport, setUploadSport] = useState<string>("hike");
  const [uploadCommunity, setUploadCommunity] = useState(true);
  const [reportFor, setReportFor] = useState<ActivityItem | null>(null);
  const [photoFor, setPhotoFor] = useState<ActivityItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/v2/integrations");
    if (res.ok) setStatus((await res.json()) as IntegrationsStatus);
  }, []);

  const loadPending = useCallback(async () => {
    const res = await fetch("/api/v2/activities?review=pending&limit=10");
    if (res.ok) setPending(((await res.json()) as { activities: ActivityItem[] }).activities);
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadPending();
    try {
      const url = new URL(window.location.href);
      const outcome = url.searchParams.get("strava");
      if (outcome) {
        setNotice(STRAVA_OUTCOME[outcome] ?? null);
        url.searchParams.delete("strava");
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      /* noop */
    }
  }, [loadStatus, loadPending]);

  // Durante il primo import ricarica lo stato finché la sync non termina.
  useEffect(() => {
    if (!status?.strava.syncing && !(status?.strava.connected && status.strava.last_sync_at == null)) return;
    const t = setTimeout(() => {
      void loadStatus();
      void loadPending();
    }, 4000);
    return () => clearTimeout(t);
  }, [status, loadStatus, loadPending]);

  const syncNow = async () => {
    setBusy("sync");
    try {
      const res = await fetch("/api/v2/integrations/strava/sync", { method: "POST" });
      const r = (await res.json()) as { imported?: number; error?: string; done?: boolean };
      setNotice(
        r.error
          ? r.error
          : `${r.imported ?? 0} nuove attività importate${r.done === false ? " (continua alla prossima sincronizzazione)" : ""}.`,
      );
    } finally {
      setBusy(null);
      void loadStatus();
      void loadPending();
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Scollegare Strava? Le attività importate da Strava e la loro heatmap verranno cancellate.")) return;
    setBusy("disconnect");
    try {
      const res = await fetch("/api/v2/integrations/strava/disconnect", { method: "POST" });
      const r = (await res.json()) as { deleted?: number };
      setNotice(`Strava scollegato. ${r.deleted ?? 0} attività rimosse.`);
    } finally {
      setBusy(null);
      void loadStatus();
      void loadPending();
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy("upload");
    setNotice(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      fd.set("sport", uploadSport);
      fd.set("community", uploadCommunity ? "1" : "0");
      const res = await fetch("/api/v2/activities/import", { method: "POST", body: fd });
      const r = (await res.json()) as {
        imported?: number;
        duplicates?: number;
        skipped_count?: number;
        skipped?: { fileName: string; reason: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(r.error ?? "Import fallito");
      const parts = [`${r.imported ?? 0} attività importate`];
      if (r.duplicates) parts.push(`${r.duplicates} già presenti`);
      if (r.skipped_count) parts.push(`${r.skipped_count} scartate (${r.skipped?.[0]?.reason ?? "formato"})`);
      setNotice(parts.join(" · "));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
      void loadStatus();
      void loadPending();
    }
  };

  const patch = async (a: ActivityItem, body: Record<string, unknown>) => {
    const res = await fetch(`/api/v2/activities/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) setNotice(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Errore");
  };

  const markDone = async (a: ActivityItem, state: "done" | "dismissed") => {
    await patch(a, { review_state: state });
    setPending((p) => p.filter((x) => x.id !== a.id));
  };

  const publish = async (a: ActivityItem, visibility: "public" | "private") => {
    setBusy(`publish:${a.id}`);
    try {
      const res = await fetch(`/api/v2/activities/${a.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      const r = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(r.error ?? "Pubblicazione fallita");
      setNotice(`"${a.name}" salvato tra i tuoi percorsi (${visibility === "public" ? "pubblico" : "privato"}).`);
      setPending((p) => p.filter((x) => x.id !== a.id));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const strava = status?.strava;

  return (
    <>
      <div className="hmr-panel rounded-lg border border-[color:var(--hmr-border)]/80 p-4">
        <h2 className="text-sm font-medium">Collegamenti e import</h2>
        <p className="mt-1 text-xs text-[color:var(--hmr-muted)]">
          Importa i tuoi giri: creano la tua heatmap e, se lo scegli, migliorano i percorsi della community.
        </p>

        {notice ? (
          <p className="mt-3 rounded-lg bg-[color:var(--hmr-elev)] px-3 py-2 text-xs" role="status">
            {notice}
          </p>
        ) : null}

        {/* Strava */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--hmr-border)]/70 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">Strava</p>
            <p className="text-[11px] text-[color:var(--hmr-muted)]">
              {!strava
                ? "…"
                : !strava.configured
                  ? "Non configurato sul server"
                  : strava.connected
                    ? `${strava.athlete_name ?? "Collegato"} · ${strava.activities} attività · ${
                        strava.syncing
                          ? "sincronizzazione in corso…"
                          : strava.last_sync_at
                            ? `sync ${fmtAgo(strava.last_sync_at)}`
                            : "in attesa del primo import"
                      }`
                    : "Import automatico a ogni accesso"}
            </p>
            {strava?.last_error ? (
              <p className="mt-0.5 text-[11px] text-[color:var(--hmr-danger)]">{strava.last_error}</p>
            ) : null}
            {strava?.connected ? (
              <p className="mt-0.5 text-[10.5px] text-[color:var(--hmr-faint)]">
                Le tracce restano private; contribuiscono in forma anonima alla heatmap community (puoi escludere singole uscite).
              </p>
            ) : null}
          </div>
          {strava?.configured && !strava.connected ? (
            <a
              href="/api/v2/integrations/strava/connect"
              className="rounded-lg px-3 py-2 text-xs font-semibold text-white"
              style={{ background: STRAVA_ORANGE }}
            >
              Connect with Strava
            </a>
          ) : null}
          {strava?.connected ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy != null || strava.syncing}
                onClick={() => void syncNow()}
                className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {busy === "sync" ? "Sincronizzo…" : "Sincronizza ora"}
              </button>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => void disconnect()}
                className="rounded-lg px-3 py-1.5 text-xs text-[color:var(--hmr-danger)] disabled:opacity-50"
              >
                Scollega
              </button>
            </div>
          ) : null}
        </div>

        {/* Upload file */}
        <div className="mt-3 rounded-lg border border-[color:var(--hmr-border)]/70 p-3">
          <p className="text-[13px] font-semibold">Komoot, Garmin e altri</p>
          <p className="text-[11px] text-[color:var(--hmr-muted)]">
            Carica GPX, TCX, FIT oppure lo ZIP dell&apos;export completo (Strava: Impostazioni → Il mio account →
            Scarica i tuoi dati; Komoot: Impostazioni → Privacy → Richiedi dati; Garmin Connect: Esporta).
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-[color:var(--hmr-muted)]">
              Sport se non indicato{" "}
              <select
                value={uploadSport}
                onChange={(e) => setUploadSport(e.target.value)}
                className="ml-1 rounded border border-[color:var(--hmr-border)] bg-transparent px-1.5 py-1 text-[11px]"
              >
                {PLANNER_ACTIVITIES.map((a) => (
                  <option key={a} value={a}>
                    {activityLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={uploadCommunity}
                onChange={(e) => setUploadCommunity(e.target.checked)}
              />
              Contribuisci alla heatmap community (anonima)
            </label>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".gpx,.tcx,.fit,.gz,.zip"
            className="hidden"
            onChange={(e) => void upload(e.target.files)}
          />
          <button
            type="button"
            disabled={busy != null}
            onClick={() => fileRef.current?.click()}
            className="mt-2 rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
          >
            {busy === "upload" ? "Importo…" : "Carica file"}
          </button>
          {status ? (
            <span className="ml-2 text-[11px] text-[color:var(--hmr-muted)]">
              {status.uploads.activities} attività da file
            </span>
          ) : null}
        </div>
      </div>

      {pending.length > 0 ? (
        <div className="hmr-panel rounded-lg border border-[color:var(--hmr-border)]/80 p-4">
          <h2 className="text-sm font-medium">Da rivedere</h2>
          <p className="mt-1 text-xs text-[color:var(--hmr-muted)]">
            Uscite recenti: segnala condizioni, pericoli o strade chiuse incontrate. Non pubblichiamo nulla senza la
            tua conferma.
          </p>
          <ul className="mt-3 space-y-2">
            {pending.map((a) => (
              <li key={a.id} className="rounded-lg border border-[color:var(--hmr-border)]/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{a.name}</p>
                    <p className="text-[11px] text-[color:var(--hmr-muted)]">
                      {sportName(a.sport)} · {fmtDate(a.start_time)} · {(a.distance_m / 1000).toFixed(1)} km · +
                      {Math.round(a.elev_gain_m)} m · {a.provider === "strava" ? "Strava" : "file"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void markDone(a, "dismissed")}
                    className="shrink-0 text-[11px] text-[color:var(--hmr-muted)]"
                  >
                    Ignora
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setReportFor(a)}
                    className="rounded-full border border-[color:var(--hmr-border)] px-2.5 py-1 text-[11px]"
                  >
                    {suggestedKind(a) === "snow_conditions" ? "Condizioni neve / valanghe" : "Segnala condizioni"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhotoFor(a)}
                    className="rounded-full border border-[color:var(--hmr-border)] px-2.5 py-1 text-[11px]"
                  >
                    Aggiungi foto
                  </button>
                  {a.can_publish ? (
                    <>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => void publish(a, "private")}
                        className="rounded-full border border-[color:var(--hmr-border)] px-2.5 py-1 text-[11px] disabled:opacity-50"
                      >
                        Salva come percorso
                      </button>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => void publish(a, "public")}
                        className="rounded-full border border-[color:var(--hmr-border)] px-2.5 py-1 text-[11px] disabled:opacity-50"
                      >
                        Pubblica in Esplora
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={async () => {
                      await patch(a, { community_consent: !a.community_consent });
                      setPending((p) =>
                        p.map((x) => (x.id === a.id ? { ...x, community_consent: !a.community_consent } : x)),
                      );
                    }}
                    className="rounded-full border border-[color:var(--hmr-border)] px-2.5 py-1 text-[11px]"
                  >
                    {a.community_consent ? "Togli dalla heatmap community" : "Aggiungi alla heatmap community"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void markDone(a, "done")}
                    className="rounded-full px-2.5 py-1 text-[11px] text-[color:var(--hmr-accent)]"
                  >
                    Fatto
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reportFor ? (
        <V2ReportCreateSheet
          lng={reportFor.high_point[0]}
          lat={reportFor.high_point[1]}
          initialKind={suggestedKind(reportFor)}
          contextLabel={`Dalla tua uscita del ${fmtDate(reportFor.start_time)}${
            reportFor.high_point[2] != null ? ` · punto più alto ${Math.round(reportFor.high_point[2])} m` : ""
          }`}
          onClose={() => setReportFor(null)}
          onCreated={() => {
            const a = reportFor;
            setReportFor(null);
            setNotice("Segnalazione pubblicata: grazie!");
            void markDone(a, "done");
          }}
        />
      ) : null}

      {photoFor ? (
        <V2PhotoCapture
          initialLng={photoFor.high_point[0]}
          initialLat={photoFor.high_point[1]}
          onClose={() => setPhotoFor(null)}
          onUploaded={() => {
            setPhotoFor(null);
            setNotice("Foto pubblicata.");
          }}
        />
      ) : null}
    </>
  );
}
