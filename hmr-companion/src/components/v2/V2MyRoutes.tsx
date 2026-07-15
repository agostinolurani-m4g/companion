"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import V2Nav from "@/components/v2/V2Nav";
import type { UserRouteActivity, UserRouteVisibility } from "@/lib/db";

type Props = {
  isAdmin?: boolean;
  username?: string;
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

const SOURCE_LABELS: Record<string, string> = {
  camptocamp: "camptocamp.org",
  gulliver: "Gulliver",
  user: "Utente",
};

const ACTIVITY_LABELS: Record<UserRouteActivity, string> = {
  road: "Strada",
  mtb: "MTB",
  hike: "Escursione",
  gravel: "Gravel",
  ski: "Scialpinismo",
};

export default function V2MyRoutes({ isAdmin = false, username }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"mine" | "public">("mine");
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<UserRouteActivity | "all">("all");

  const load = useCallback(async (scope: "mine" | "public") => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v2/routes?scope=${scope === "public" ? "public" : "mine"}`);
      const data = (await res.json()) as { error?: string; routes?: RouteItem[] };
      if (!res.ok) throw new Error(data.error ?? "Caricamento fallito");
      setRoutes(data.routes ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRoutes([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

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
      void load(tab);
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
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const visibleRoutes =
    activityFilter === "all" ? routes : routes.filter((r) => r.activity === activityFilter);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="mx-auto w-full max-w-3xl flex-1 p-4">
        <h1 className="text-xl font-semibold">Area personale</h1>
        <p className="mt-1 text-sm text-[color:var(--hmr-muted)]">
          I tuoi percorsi sono privati di default. Puoi renderli pubblici quando vuoi.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={
              tab === "mine"
                ? "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                : "rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs text-[color:var(--hmr-muted)]"
            }
          >
            I miei percorsi
          </button>
          <button
            type="button"
            onClick={() => setTab("public")}
            className={
              tab === "public"
                ? "rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
                : "rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs text-[color:var(--hmr-muted)]"
            }
          >
            Pubblici
          </button>
          <Link
            href="/v2/plan"
            className="ml-auto rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs text-[color:var(--hmr-accent)]"
          >
            + Nuovo percorso
          </Link>
          <Link
            href="/v2/scialpinismo/esplora"
            className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs text-[color:var(--hmr-accent)]"
          >
            Mappa gite
          </Link>
          <Link
            href="/v2/scialpinismo/nuova"
            className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-1.5 text-xs text-[color:var(--hmr-accent)]"
          >
            + Gita sci
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

        {busy ? (
          <p className="mt-6 text-sm text-[color:var(--hmr-muted)]">Caricamento…</p>
        ) : visibleRoutes.length === 0 ? (
          <p className="mt-6 text-sm text-[color:var(--hmr-muted)]">
            {tab === "mine" ? "Nessun percorso salvato." : "Nessun percorso pubblico."}
          </p>
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
                    {tab === "public" ? ` · di ${r.owner}` : null}
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
                      {r.license ? ` · ${r.license}` : null}
                    </span>
                  ) : null}
                  {r.source_url ? (
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 text-[10px] text-[color:var(--hmr-accent)] underline"
                    >
                      Fonte
                    </a>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={
                      r.activity === "ski"
                        ? `/v2/scialpinismo?route=${encodeURIComponent(r.id)}`
                        : `/v2/plan?route=${encodeURIComponent(r.id)}`
                    }
                    className="rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
                  >
                    Apri
                  </Link>
                  {tab === "mine" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void toggleVisibility(r)}
                        className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs"
                      >
                        {r.visibility === "public" ? "Rendi privato" : "Rendi pubblico"}
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === r.id}
                        onClick={() => void deleteRoute(r)}
                        className="rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-400 disabled:opacity-50"
                      >
                        {deletingId === r.id ? "Elimino…" : "Elimina"}
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {err ? <p className="mt-4 text-xs text-red-400">{err}</p> : null}
      </div>
    </div>
  );
}
