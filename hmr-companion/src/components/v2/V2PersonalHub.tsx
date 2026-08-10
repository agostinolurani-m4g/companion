"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import V2Nav from "@/components/v2/V2Nav";
import V2PhotoCapture from "@/components/v2/V2PhotoCapture";
import type { UserRouteActivity, UserRouteVisibility } from "@/lib/db";
import { avatarUrl } from "@/lib/social-labels";
import { formatOutingDate } from "@/lib/outings-types";
import type { OutingDto } from "@/lib/outings-types";
import { REPORT_KIND_LABELS } from "@/lib/field-reports";

type Props = {
  isAdmin?: boolean;
  username?: string;
};

type HubTab = "overview" | "routes" | "outings" | "photos" | "reports";

type Profile = {
  username: string;
  display_name: string;
  avatar_path: string | null;
  trust_tier_label: string;
  trust_score: number;
  stats?: UserStats;
};

type UserStats = {
  total_routes: number;
  public_routes: number;
  total_km: number;
  total_elev_gain_m: number;
  outings_count: number;
  photos_count: number;
  reports_sent: number;
  reports_verified: number;
  confirmations_received: number;
  by_activity: Record<UserRouteActivity, number>;
};

type RouteItem = {
  id: string;
  owner: string;
  name: string;
  activity: UserRouteActivity;
  length_km: number;
  elev_gain_m: number;
  visibility: UserRouteVisibility;
  source?: string | null;
  source_url?: string | null;
  license?: string | null;
  updated_at: number;
};

type PhotoItem = {
  id: string;
  lng: number;
  lat: number;
  caption: string;
  url: string | null;
  created_at: number;
};

type ReportItem = {
  id: string;
  kind: string;
  kind_label: string;
  description: string;
  status: string;
  confirmation_count: number;
  verified: boolean;
  created_at: number;
};

const ACTIVITY_LABELS: Record<UserRouteActivity, string> = {
  road: "Strada",
  mtb: "MTB",
  hike: "Escursione",
  gravel: "Gravel",
  ski: "Scialpinismo",
};

const SOURCE_LABELS: Record<string, string> = {
  camptocamp: "camptocamp.org",
  gulliver: "Gulliver",
  user: "Utente",
};

const TABS: { id: HubTab; label: string }[] = [
  { id: "overview", label: "Panoramica" },
  { id: "routes", label: "Percorsi" },
  { id: "outings", label: "Gite" },
  { id: "photos", label: "Foto" },
  { id: "reports", label: "Segnalazioni" },
];

function routeHref(activity: UserRouteActivity, id: string): string {
  return activity === "ski"
    ? `/v2/scialpinismo?route=${encodeURIComponent(id)}`
    : `/v2/plan?route=${encodeURIComponent(id)}`;
}

export default function V2PersonalHub({ isAdmin = false, username }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<HubTab>("overview");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routesTab, setRoutesTab] = useState<"mine" | "public">("mine");
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [outings, setOutings] = useState<OutingDto[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<UserRouteActivity | "all">("all");
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);

  const loadProfile = useCallback(async () => {
    const res = await fetch("/api/v2/profile");
    const data = (await res.json()) as { error?: string; profile?: Profile };
    if (!res.ok) throw new Error(data.error ?? "Profilo non caricato");
    setProfile(data.profile ?? null);
  }, []);

  const loadRoutes = useCallback(async (scope: "mine" | "public") => {
    const res = await fetch(`/api/v2/routes?scope=${scope === "public" ? "public" : "mine"}`);
    const data = (await res.json()) as { error?: string; routes?: RouteItem[] };
    if (!res.ok) throw new Error(data.error ?? "Percorsi non caricati");
    setRoutes(data.routes ?? []);
  }, []);

  const loadOutings = useCallback(async () => {
    const res = await fetch("/api/v2/outings?scope=mine");
    const data = (await res.json()) as { error?: string; outings?: OutingDto[] };
    if (!res.ok) throw new Error(data.error ?? "Gite non caricate");
    setOutings(data.outings ?? []);
  }, []);

  const loadPhotos = useCallback(async () => {
    const res = await fetch("/api/v2/photos");
    const data = (await res.json()) as { error?: string; photos?: PhotoItem[] };
    if (!res.ok) throw new Error(data.error ?? "Foto non caricate");
    setPhotos(data.photos ?? []);
  }, []);

  const loadReports = useCallback(async () => {
    const res = await fetch(`/api/v2/reports?author=${encodeURIComponent(username ?? "")}`);
    const data = (await res.json()) as { error?: string; reports?: ReportItem[] };
    if (!res.ok) throw new Error(data.error ?? "Segnalazioni non caricate");
    setReports(data.reports ?? []);
  }, [username]);

  const loadAll = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      await Promise.all([
        loadProfile(),
        loadRoutes("mine"),
        loadOutings(),
        loadPhotos(),
        loadReports(),
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadProfile, loadRoutes, loadOutings, loadPhotos, loadReports]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (tab === "routes") void loadRoutes(routesTab);
  }, [tab, routesTab, loadRoutes]);

  const toggleVisibility = async (route: RouteItem) => {
    const next: UserRouteVisibility = route.visibility === "public" ? "private" : "public";
    try {
      const res = await fetch(`/api/v2/routes/${encodeURIComponent(route.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Aggiornamento fallito");
      void loadRoutes(routesTab);
      void loadProfile();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteRoute = async (route: RouteItem) => {
    if (!window.confirm(`Eliminare "${route.name}"?`)) return;
    setDeletingId(route.id);
    try {
      const res = await fetch(`/api/v2/routes/${encodeURIComponent(route.id)}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Eliminazione fallita");
      setRoutes((list) => list.filter((r) => r.id !== route.id));
      void loadProfile();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const stats = profile?.stats;
  const visibleRoutes =
    activityFilter === "all" ? routes : routes.filter((r) => r.activity === activityFilter);
  const avatarSrc = profile ? avatarUrl(profile.avatar_path) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="mx-auto w-full max-w-3xl flex-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Area personale</h1>
            <p className="mt-1 text-sm text-[color:var(--hmr-muted)]">
              Il tuo profilo, percorsi, gite e contributi sulla mappa.
            </p>
          </div>
          {username ? (
            <Link
              href={`/v2/u/${encodeURIComponent(username)}`}
              className="shrink-0 text-xs text-[color:var(--hmr-accent)]"
            >
              Profilo pubblico →
            </Link>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                tab === t.id
                  ? "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                  : "rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs text-[color:var(--hmr-muted)]"
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {busy ? (
          <p className="mt-6 text-sm text-[color:var(--hmr-muted)]">Caricamento…</p>
        ) : tab === "overview" && stats ? (
          <div className="mt-4 grid gap-4">
            <div className="hmr-panel flex items-center gap-4 rounded-2xl border border-[color:var(--hmr-border)]/80 p-4">
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--hmr-elev)] text-xl font-semibold text-[color:var(--hmr-accent)]">
                  {(profile?.display_name ?? "?").charAt(0)}
                </div>
              )}
              <div>
                <p className="font-medium">{profile?.display_name}</p>
                <span className="mt-1 inline-block rounded-full bg-[color:var(--hmr-accent)]/15 px-2 py-0.5 text-[10px] text-[color:var(--hmr-accent)]">
                  {profile?.trust_tier_label} · {profile?.trust_score} pt
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Km totali", value: stats.total_km.toFixed(0) },
                { label: "Dislivello", value: `+${Math.round(stats.total_elev_gain_m)} m` },
                { label: "Gite", value: String(stats.outings_count) },
                { label: "Foto", value: String(stats.photos_count) },
              ].map((card) => (
                <div
                  key={card.label}
                  className="hmr-panel rounded-xl border border-[color:var(--hmr-border)]/60 p-3 text-center"
                >
                  <p className="text-lg font-semibold">{card.value}</p>
                  <p className="text-[10px] text-[color:var(--hmr-muted)]">{card.label}</p>
                </div>
              ))}
            </div>

            <div className="hmr-panel rounded-2xl border border-[color:var(--hmr-border)]/80 p-4">
              <h2 className="text-sm font-medium">Affidabilità</h2>
              <p className="mt-1 text-xs text-[color:var(--hmr-muted)]">
                {stats.reports_verified} segnalazioni verificate · {stats.confirmations_received}{" "}
                conferme ricevute
              </p>
            </div>

            <div className="hmr-panel rounded-2xl border border-[color:var(--hmr-border)]/80 p-4">
              <h2 className="text-sm font-medium">Percorsi per sport</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {(Object.keys(ACTIVITY_LABELS) as UserRouteActivity[]).map((a) => (
                  <span
                    key={a}
                    className="rounded-full border border-[color:var(--hmr-border)] px-2 py-0.5 text-[10px]"
                  >
                    {ACTIVITY_LABELS[a]}: {stats.by_activity[a]}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/v2/plan"
                className="rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
              >
                + Nuovo percorso
              </Link>
              <Link
                href="/v2/scialpinismo"
                className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs text-[color:var(--hmr-accent)]"
              >
                Traccia scialpinismo
              </Link>
              <Link
                href="/v2/scialpinismo/nuova"
                className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs text-[color:var(--hmr-accent)]"
              >
                Carica gita
              </Link>
              <Link
                href="/v2/foto"
                className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs text-[color:var(--hmr-accent)]"
              >
                Carica foto
              </Link>
              <Link
                href="/v2/esplora"
                className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs text-[color:var(--hmr-accent)]"
              >
                Esplora mappa
              </Link>
            </div>
          </div>
        ) : tab === "routes" ? (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRoutesTab("mine")}
                className={
                  routesTab === "mine"
                    ? "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                    : "rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs"
                }
              >
                I miei
              </button>
              <button
                type="button"
                onClick={() => setRoutesTab("public")}
                className={
                  routesTab === "public"
                    ? "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                    : "rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs"
                }
              >
                Pubblici
              </button>
              <Link href="/v2/plan" className="ml-auto text-xs text-[color:var(--hmr-accent)]">
                + Nuovo
              </Link>
              <Link href="/v2/scialpinismo" className="text-xs text-[color:var(--hmr-accent)]">
                Traccia scialpinismo
              </Link>
              <Link href="/v2/scialpinismo/nuova" className="text-xs text-[color:var(--hmr-accent)]">
                Carica gita
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {(["all", "ski", "hike", "road", "mtb", "gravel"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setActivityFilter(a)}
                  className={
                    activityFilter === a
                      ? "rounded-lg bg-[color:var(--hmr-accent)]/20 px-2 py-0.5 text-[10px] text-[color:var(--hmr-accent)]"
                      : "rounded-lg border border-[color:var(--hmr-border)] px-2 py-0.5 text-[10px] text-[color:var(--hmr-muted)]"
                  }
                >
                  {a === "all" ? "Tutti" : ACTIVITY_LABELS[a]}
                </button>
              ))}
            </div>
            {visibleRoutes.length === 0 ? (
              <p className="mt-6 text-sm text-[color:var(--hmr-muted)]">Nessun percorso.</p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {visibleRoutes.map((r) => (
                  <li
                    key={r.id}
                    className="hmr-panel flex flex-col gap-3 rounded-2xl border border-[color:var(--hmr-border)]/80 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-medium">{r.name}</h2>
                      <p className="mt-0.5 text-xs text-[color:var(--hmr-muted)]">
                        {ACTIVITY_LABELS[r.activity]} · {r.length_km.toFixed(1)} km
                      </p>
                      <span
                        className={
                          r.visibility === "public"
                            ? "mt-1 inline-block rounded-full bg-[color:var(--hmr-safe)]/15 px-2 py-0.5 text-[10px] text-[color:var(--hmr-safe)]"
                            : "mt-1 inline-block rounded-full bg-[color:var(--hmr-faint)]/20 px-2 py-0.5 text-[10px] text-[color:var(--hmr-muted)]"
                        }
                      >
                        {r.visibility === "public" ? "Pubblico" : "Privato"}
                      </span>
                      {r.source ? (
                        <span className="ml-1 inline-block rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300">
                          {SOURCE_LABELS[r.source] ?? r.source}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={routeHref(r.activity, r.id)}
                        className="rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
                      >
                        Apri
                      </Link>
                      {routesTab === "mine" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void toggleVisibility(r)}
                            className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs"
                          >
                            {r.visibility === "public" ? "Privato" : "Pubblico"}
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === r.id}
                            onClick={() => void deleteRoute(r)}
                            className="rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-400 disabled:opacity-50"
                          >
                            Elimina
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : tab === "outings" ? (
          <div className="mt-4">
            {outings.length === 0 ? (
              <p className="text-sm text-[color:var(--hmr-muted)]">Nessuna gita registrata.</p>
            ) : (
              <ul className="grid gap-2">
                {outings.map((o) => (
                  <li
                    key={o.id}
                    className="hmr-panel rounded-xl border border-[color:var(--hmr-border)]/60 p-3"
                  >
                    <Link
                      href={routeHref(o.activity, o.route_id)}
                      className="font-medium hover:text-[color:var(--hmr-accent)]"
                    >
                      {o.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-[color:var(--hmr-muted)]">
                      {ACTIVITY_LABELS[o.activity]} · {formatOutingDate(o.outing_date)}
                    </p>
                    {o.notes ? (
                      <p className="mt-1 text-xs text-[color:var(--hmr-text)]">{o.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : tab === "photos" ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowPhotoCapture(true)}
              className="mb-4 rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
            >
              + Carica foto
            </button>
            {photos.length === 0 ? (
              <p className="text-sm text-[color:var(--hmr-muted)]">Nessuna foto ancora.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photos.map((p) => (
                  <div
                    key={p.id}
                    className="overflow-hidden rounded-xl border border-[color:var(--hmr-border)]/60"
                  >
                    {p.url ? (
                      <img src={p.url} alt="" className="aspect-square w-full object-cover" />
                    ) : null}
                    {p.caption ? (
                      <p className="truncate px-2 py-1 text-[10px] text-[color:var(--hmr-muted)]">
                        {p.caption}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === "reports" ? (
          <div className="mt-4">
            {reports.length === 0 ? (
              <p className="text-sm text-[color:var(--hmr-muted)]">Nessuna segnalazione inviata.</p>
            ) : (
              <ul className="grid gap-2">
                {reports.map((r) => (
                  <li
                    key={r.id}
                    className="hmr-panel rounded-xl border border-[color:var(--hmr-border)]/60 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {r.kind_label || REPORT_KIND_LABELS[r.kind as keyof typeof REPORT_KIND_LABELS]}
                      </span>
                      <span
                        className={
                          r.verified
                            ? "text-[10px] text-[color:var(--hmr-safe)]"
                            : "text-[10px] text-[color:var(--hmr-muted)]"
                        }
                      >
                        {r.status === "resolved"
                          ? "Risolta"
                          : r.verified
                            ? "Verificata"
                            : `${r.confirmation_count} conferme`}
                      </span>
                    </div>
                    {r.description ? (
                      <p className="mt-1 text-xs text-[color:var(--hmr-muted)]">{r.description}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {err ? <p className="mt-4 text-xs text-red-400">{err}</p> : null}
      </div>

      {showPhotoCapture ? (
        <V2PhotoCapture
          onClose={() => setShowPhotoCapture(false)}
          onUploaded={() => {
            setShowPhotoCapture(false);
            void loadPhotos();
            void loadProfile();
          }}
        />
      ) : null}
    </div>
  );
}
