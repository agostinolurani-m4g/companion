"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CanonicalRouteRow,
  ItineraryRow,
  OutingForUserListRow,
  UserRow,
} from "@/lib/types";

type MePayload = {
  user: UserRow;
  friends: UserRow[];
  following: UserRow[];
  routes: CanonicalRouteRow[];
  outings: OutingForUserListRow[];
  itineraries: ItineraryRow[];
};

export type SocialMapLayerOption = "off" | "friends" | "group" | "following" | "public";

type Props = {
  itineraries: ItineraryRow[];
  onSelectItinerary: (id: string | null) => void | Promise<void>;
  onOpenProfile: () => void;
  /** Cambia dopo salvataggio profilo / utente attivo per ricaricare i dati. */
  refreshKey?: string;
  /** Stato livello mappa sociale (colonna destra). */
  socialMapLayer: SocialMapLayerOption;
  onSocialMapLayerChange: (layer: SocialMapLayerOption) => void;
  /** Espande la mappa e attiva un feed sociale visibile. */
  onShowSocialOnMap: (layer: Exclude<SocialMapLayerOption, "off">) => void;
};

const visLabel: Record<string, string> = {
  private: "Privato",
  friends: "Amici",
  group: "Gruppo",
  followers: "Chi mi segue",
  public: "Pubblico",
};

const layerUi: Record<SocialMapLayerOption, string> = {
  off: "Spento",
  friends: "Amici",
  group: "Gruppo CAI",
  following: "Seguiti",
  public: "Pubblico",
};

export function UserHubTab({
  itineraries,
  onSelectItinerary,
  onOpenProfile,
  refreshKey,
  socialMapLayer,
  onSocialMapLayerChange,
  onShowSocialOnMap,
}: Props) {
  const [data, setData] = useState<MePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await fetch("/api/social/me");
    if (res.status === 400) {
      const j = (await res.json()) as { error?: string };
      setErr(j.error ?? "Utente non impostato.");
      setData(null);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setErr("Impossibile caricare l’hub.");
      setData(null);
      setLoading(false);
      return;
    }
    const j = (await res.json()) as MePayload;
    setData(j);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="min-h-0 flex-1 rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-4 text-xs text-zinc-500">
        Caricamento…
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-amber-900/40 bg-amber-950/20 p-4">
        <p className="text-xs text-amber-100/90">{err ?? "Dati non disponibili."}</p>
        <button
          type="button"
          className="rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          onClick={() => onOpenProfile()}
        >
          Apri profilo
        </button>
      </div>
    );
  }

  const { user, friends, following, routes, outings } = data;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-3">
      <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/60 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Utente attivo</p>
        <p className="mt-1 text-sm font-semibold text-zinc-100">{user.display_name}</p>
        <p className="text-xs text-zinc-400">
          {user.role}
          {user.handle ? ` · @${user.handle}` : ""}
        </p>
      </div>

      <section className="rounded-lg border border-sky-800/45 bg-sky-950/25 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-sky-400/95">
          Mappa sociale (altri percorsi)
        </h3>
        <p className="mt-1 text-[10px] leading-snug text-zinc-400">
          Le uscite di amici, gruppo e pubblico compaiono come <strong className="text-zinc-300">linee tratteggiate</strong>{" "}
          sulla mappa a destra. Qui sotto puoi attivare il livello e aprire la mappa in grande.
        </p>
        <p className="mt-2 text-[10px] text-zinc-500">
          Livello selezionato:{" "}
          <span className="font-medium text-sky-300">{layerUi[socialMapLayer]}</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(["friends", "group", "following", "public"] as const).map((layer) => (
            <button
              key={layer}
              type="button"
              className="rounded border border-sky-700/60 bg-sky-950/50 px-2 py-1 text-[10px] font-medium text-sky-100 hover:bg-sky-900/60"
              onClick={() => onShowSocialOnMap(layer)}
            >
              Mostra: {layerUi[layer]}
            </button>
          ))}
        </div>
        <label className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
          <span className="text-zinc-600">Solo livello</span>
          <select
            className="max-w-[140px] rounded border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300"
            value={socialMapLayer}
            onChange={(e) => onSocialMapLayerChange(e.target.value as SocialMapLayerOption)}
          >
            <option value="off">{layerUi.off}</option>
            <option value="friends">{layerUi.friends}</option>
            <option value="group">{layerUi.group}</option>
            <option value="following">{layerUi.following}</option>
            <option value="public">{layerUi.public}</option>
          </select>
        </label>
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Pianificazione locale
        </h3>
        <p className="mt-1 text-[10px] text-zinc-600">
          Itinerari su questo dispositivo (non legati a un account remoto).
        </p>
        <ul className="mt-2 space-y-1">
          {itineraries.length === 0 ? (
            <li className="text-xs text-zinc-500">Nessun itinerario.</li>
          ) : (
            itineraries.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-2 rounded border border-zinc-800/80 bg-zinc-950/40 px-2 py-1.5"
              >
                <span className="min-w-0 truncate text-xs text-zinc-200">{it.name}</span>
                <button
                  type="button"
                  className="shrink-0 rounded bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-100 hover:bg-zinc-600"
                  onClick={() => void onSelectItinerary(it.id)}
                >
                  Apri
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          I miei percorsi
        </h3>
        <ul className="mt-2 space-y-2">
          {routes.length === 0 ? (
            <li className="text-xs text-zinc-500">Nessun percorso canonico creato da te.</li>
          ) : (
            routes.map((r) => (
              <li
                key={r.id}
                className="rounded border border-zinc-800/80 bg-zinc-950/40 px-2 py-2 text-xs"
              >
                <div className="font-medium text-zinc-100">{r.name}</div>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">{r.summary}</p>
                <p className="mt-1 text-[10px] text-zinc-600">
                  {r.activity_kind}
                  {r.region ? ` · ${r.region}` : ""}
                </p>
              </li>
            ))
          )}
        </ul>
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">I miei giri</h3>
        <ul className="mt-2 space-y-2">
          {outings.length === 0 ? (
            <li className="text-xs text-zinc-500">Nessuna uscita registrata.</li>
          ) : (
            outings.map((o) => (
              <li
                key={o.id}
                className="rounded border border-zinc-800/80 bg-zinc-950/40 px-2 py-2 text-xs"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <span className="font-medium text-zinc-100">{o.route_name}</span>
                  <span className="text-[10px] text-zinc-500">
                    {new Date(o.started_at).toLocaleDateString("it-IT", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">
                  {o.role === "author" ? "Autore" : "Partecipante"} · {visLabel[o.visibility] ?? o.visibility}{" "}
                  · {o.author_display_name}
                </p>
                {o.notes ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-zinc-400">{o.notes}</p>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Amici</h3>
          <ul className="mt-2 space-y-1">
            {friends.length === 0 ? (
              <li className="text-xs text-zinc-500">Nessun amico in elenco.</li>
            ) : (
              friends.map((f) => (
                <li key={f.id} className="text-xs text-zinc-300">
                  {f.display_name}{" "}
                  <span className="text-zinc-600">
                    ({f.role}
                    {f.handle ? ` · @${f.handle}` : ""})
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Seguiti</h3>
          <ul className="mt-2 space-y-1">
            {following.length === 0 ? (
              <li className="text-xs text-zinc-500">Non segui nessuno.</li>
            ) : (
              following.map((f) => (
                <li key={f.id} className="text-xs text-zinc-300">
                  {f.display_name}{" "}
                  <span className="text-zinc-600">
                    ({f.role}
                    {f.handle ? ` · @${f.handle}` : ""})
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <button
        type="button"
        className="w-full rounded border border-zinc-600 bg-zinc-800/80 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
        onClick={() => void load()}
      >
        Aggiorna
      </button>
    </div>
  );
}
