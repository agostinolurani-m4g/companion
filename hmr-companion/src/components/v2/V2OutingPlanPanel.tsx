"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/v2/ui/Icon";
import V2StageList from "@/components/v2/V2StageList";
import { buildStages, suggestOvernightKms, type ProfilePoint } from "@/lib/multiday";
import { OUTING_STOP_KIND_META, OUTING_STOP_KINDS, outingDays, type OutingStopKind } from "@/lib/outings-types";
import type { UserRouteActivity } from "@/lib/sports";
import type { OutingDraftApi } from "@/lib/use-outing-draft";

type GroupItem = { id: string; name: string };

/** Scorciatoie di ricerca lungo il percorso (gestite dal planner). */
export type AlongSearchKind = "huts" | "food" | "supermarket" | "water";

const ALONG_SEARCH: { id: AlongSearchKind; label: string }[] = [
  { id: "huts", label: "Rifugi e bivacchi" },
  { id: "food", label: "Ristoranti" },
  { id: "supermarket", label: "Supermercati" },
  { id: "water", label: "Acqua" },
];

type Props = {
  api: OutingDraftApi;
  /** Il percorso ha una traccia calcolata (servono partenza e arrivo). */
  hasRoute: boolean;
  onFindAlong?: (kind: AlongSearchKind) => void;
  onFocusStop?: (lng: number, lat: number) => void;
  /** Profilo `[lng, lat, quota, km]` della traccia: serve per dividere la gita in tappe. */
  profile?: readonly ProfilePoint[] | null;
  activity?: UserRouteActivity;
};

/** Tipi di sosta dove ha senso dormire. */
const SLEEP_KINDS = new Set<OutingStopKind>(["hut", "bivouac", "lodging"]);

export default function V2OutingPlanPanel({ api, hasRoute, onFindAlong, onFocusStop, profile = null, activity = "hike" }: Props) {
  const { draft, patch, updateStop, removeStop, addStop } = api;
  const [splitDays, setSplitDays] = useState(2);
  const days = outingDays(draft.stops);
  const hasProfile = !!profile && profile.length >= 2;
  const stages = useMemo(
    () =>
      hasProfile
        ? buildStages(
            profile,
            draft.stops
              .filter((s) => s.role === "stop" && s.overnight && s.along_km != null)
              .map((s) => ({ km: s.along_km as number, name: s.name })),
            activity,
          )
        : [],
    [hasProfile, profile, draft.stops, activity],
  );

  /** Aggiunge i pernotti che dividono la traccia in giorni di impegno simile. */
  const splitEvenly = () => {
    if (!hasProfile) return;
    for (const km of suggestOvernightKms(profile, splitDays, activity)) {
      let best = profile[0];
      for (const p of profile) if (Math.abs(p[3] - km) < Math.abs(best[3] - km)) best = p;
      addStop({ kind: "bivouac", name: "", lng: best[0], lat: best[1], overnight: true });
    }
  };
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [participantsText, setParticipantsText] = useState("");

  useEffect(() => {
    setParticipantsText(draft.participants.join(", "));
    // Solo al caricamento di una gita esistente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v2/groups");
        const data = (await res.json()) as { groups?: GroupItem[] };
        if (data.groups) setGroups(data.groups.map((g) => ({ id: g.id, name: g.name })));
      } catch {
        /* opzionale */
      }
    })();
  }, []);

  if (!hasRoute) {
    return (
      <p className="text-[12.5px] text-[color:var(--hmr-muted)]">
        Traccia prima il percorso: la gita si pianifica su una traccia (partenza, arrivo, soste lungo il tragitto).
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {api.loading ? <p className="text-[12px] text-[color:var(--hmr-muted)]">Carico la gita…</p> : null}

      <section className="space-y-2">
        <input
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Nome della gita (es. Pizzo Coppetto con Luca)"
          aria-label="Nome gita"
          className="ui-input w-full !text-[13px]"
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={draft.outing_date}
            onChange={(e) => patch({ outing_date: e.target.value })}
            aria-label="Data"
            className="ui-input flex-1 !text-[13px]"
          />
          <input
            type="time"
            value={draft.start_time}
            onChange={(e) => patch({ start_time: e.target.value })}
            aria-label="Ora di partenza"
            className="ui-input w-28 !text-[13px]"
          />
        </div>
      </section>

      <section>
        <h3 className="ui-eyebrow mb-2">Tappe della gita</h3>
        <ol className="space-y-1.5">
          {draft.stops.map((s, i) => {
            const meta = OUTING_STOP_KIND_META[s.kind];
            const roleLabel = s.role === "start" ? "Partenza" : s.role === "end" ? "Arrivo" : meta.label;
            return (
              <li
                key={`${s.role}-${s.ref ?? ""}-${i}`}
                className="flex items-start gap-2 rounded-lg border border-[color:var(--hmr-border)]/60 px-2 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => onFocusStop?.(s.lng, s.lat)}
                  className="mt-0.5 w-11 shrink-0 text-right text-[11.5px] font-bold tabular-nums text-[color:var(--hmr-accent)]"
                  title="Mostra sulla mappa"
                >
                  {s.role === "start" ? "0" : s.along_km != null ? s.along_km.toFixed(1) : "—"}
                  <span className="ml-0.5 text-[10px] font-semibold text-[color:var(--hmr-faint)]">km</span>
                </button>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden>{s.role === "start" ? "🟢" : s.role === "end" ? "🏁" : meta.icon}</span>
                    {s.role === "stop" ? (
                      <select
                        value={s.kind}
                        onChange={(e) => updateStop(i, { kind: e.target.value as OutingStopKind })}
                        aria-label="Tipo sosta"
                        className="bg-transparent text-[11px] font-semibold uppercase tracking-wide text-[color:var(--hmr-faint)]"
                      >
                        {OUTING_STOP_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {OUTING_STOP_KIND_META[k].label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--hmr-faint)]">
                        {roleLabel}
                      </span>
                    )}
                  </div>
                  <input
                    value={s.name}
                    onChange={(e) => updateStop(i, { name: e.target.value })}
                    placeholder={s.role === "start" ? "Es. Parcheggio Montespluga" : s.role === "end" ? "Es. Stazione di Chiavenna" : "Nome"}
                    className="w-full bg-transparent text-[13px] font-semibold outline-none placeholder:font-normal placeholder:text-[color:var(--hmr-faint)]"
                  />
                  <input
                    value={s.note}
                    onChange={(e) => updateStop(i, { note: e.target.value })}
                    placeholder="Nota (orari, prenotazione, cosa comprare…)"
                    className="w-full bg-transparent text-[11.5px] text-[color:var(--hmr-muted)] outline-none placeholder:text-[color:var(--hmr-faint)]"
                  />
                  {s.role === "stop" && (s.overnight || SLEEP_KINDS.has(s.kind) || days > 1) ? (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-[color:var(--hmr-muted)]">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-[color:var(--hmr-accent)]"
                        checked={s.overnight === true}
                        onChange={(e) => updateStop(i, { overnight: e.target.checked })}
                      />
                      Si dorme qui (fine tappa)
                    </label>
                  ) : null}
                </div>
                {s.role === "stop" ? (
                  <button type="button" onClick={() => removeStop(i)} className="ui-icon-btn !h-7 !w-7" aria-label="Rimuovi sosta">
                    <Icon name="x" size={14} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-[11.5px] text-[color:var(--hmr-faint)]">
          Aggiungi soste dalla mappa o dai Dintorni con “Aggiungi alla gita”: la traccia non cambia.
        </p>
        {onFindAlong ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ALONG_SEARCH.map((a) => (
              <button key={a.id} type="button" className="ui-chip !text-[12px]" onClick={() => onFindAlong(a.id)}>
                <Icon name="search" size={13} />
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <h3 className="ui-eyebrow mb-2">Più giorni</h3>
        {days > 1 ? (
          <>
            <p className="mb-2 text-[12.5px]">
              <b>{days} giorni</b> · {days - 1} {days === 2 ? "notte" : "notti"} fuori
            </p>
            {stages.length > 1 ? <V2StageList stages={stages} startDate={draft.outing_date || null} /> : null}
            {!hasProfile ? (
              <p className="text-[11.5px] text-[color:var(--hmr-faint)]">Il profilo altimetrico non è disponibile: le tappe non hanno dislivello e tempi.</p>
            ) : null}
          </>
        ) : (
          <p className="text-[12px] text-[color:var(--hmr-muted)]">
            Gita di un giorno. Per una traversata segna “Si dorme qui” su un rifugio o bivacco tra le tappe, oppure dividi la
            traccia in giorni di impegno simile.
          </p>
        )}
        {hasProfile && days === 1 ? (
          <div className="mt-2 flex items-center gap-2">
            <select
              value={splitDays}
              onChange={(e) => setSplitDays(Number(e.target.value))}
              aria-label="Numero di giorni"
              className="ui-input !min-h-[34px] w-28 !text-[12.5px]"
            >
              {[2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} giorni
                </option>
              ))}
            </select>
            <button type="button" className="ui-btn ui-btn-sm" onClick={splitEvenly}>
              Dividi in tappe
            </button>
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="ui-eyebrow">Compagni</h3>
        <input
          value={participantsText}
          onChange={(e) => {
            setParticipantsText(e.target.value);
            patch({
              participants: e.target.value
                .split(/[,;\s]+/)
                .map((u) => u.trim().toLowerCase())
                .filter(Boolean),
            });
          }}
          placeholder="Username separati da virgola"
          className="ui-input w-full !text-[13px]"
        />
        {groups.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g) => {
              const on = draft.group_ids.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  className="ui-chip !text-[12px]"
                  onClick={() =>
                    patch({ group_ids: on ? draft.group_ids.filter((id) => id !== g.id) : [...draft.group_ids, g.id] })
                  }
                >
                  <Icon name="users" size={13} />
                  {g.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="ui-eyebrow">Note logistiche</h3>
        <textarea
          value={draft.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          rows={3}
          placeholder="Materiale, auto condivise, piano B, orario di rientro…"
          className="ui-input w-full !min-h-[72px] !py-2 !text-[13px]"
        />
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[color:var(--hmr-muted)]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[color:var(--hmr-accent)]"
            checked={draft.visibility === "public"}
            onChange={(e) => patch({ visibility: e.target.checked ? "public" : "participants" })}
          />
          Gita pubblica (altrimenti solo compagni e gruppi)
        </label>
      </section>

      {api.error ? <p className="text-[12px] text-[color:var(--hmr-danger)]">{api.error}</p> : null}
    </div>
  );
}
