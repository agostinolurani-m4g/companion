"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { formatOutingDate, type SkiOutingDto } from "@/lib/ski-outings-types";

type GroupItem = { id: string; name: string };

type Props = {
  routeId: string;
  routeName: string;
  /** Se false, mostra solo la lista (es. percorso non ancora salvato). */
  canRegister?: boolean;
  initialShowForm?: boolean;
  className?: string;
};

export default function V2SkiOutingPanel({
  routeId,
  routeName,
  canRegister = true,
  initialShowForm = false,
  className = "",
}: Props) {
  const [outings, setOutings] = useState<SkiOutingDto[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(initialShowForm);
  const [saveBusy, setSaveBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [outingDate, setOutingDate] = useState("");
  const [snowNotes, setSnowNotes] = useState("");
  const [participantsText, setParticipantsText] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const loadOutings = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await fetchJson<{ outings?: SkiOutingDto[] }>(
        `/api/v2/ski/outings?route_id=${encodeURIComponent(routeId)}`,
      );
      setOutings(data.outings ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setOutings([]);
    } finally {
      setBusy(false);
    }
  }, [routeId]);

  useEffect(() => {
    void loadOutings();
  }, [loadOutings]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v2/groups");
        const data = (await res.json()) as { groups?: GroupItem[] };
        if (data.groups) setGroups(data.groups.map((g) => ({ id: g.id, name: g.name })));
      } catch {
        /* optional */
      }
    })();
  }, []);

  const resetForm = () => {
    setTitle("");
    setOutingDate("");
    setSnowNotes("");
    setParticipantsText("");
    setSelectedGroupIds([]);
  };

  const submitOuting = async () => {
    setSaveBusy(true);
    setErr(null);
    try {
      const participants = participantsText
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const res = await fetch("/api/v2/ski/outings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route_id: routeId,
          title: title.trim() || routeName || "Gita scialpinismo",
          outing_date: outingDate || null,
          snow_notes: snowNotes,
          participants,
          group_ids: selectedGroupIds,
          make_route_public: true,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Registrazione gita fallita");
      resetForm();
      setShowForm(false);
      await loadOutings();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <section
      className={`rounded-lg border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)] p-2.5 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--hmr-faint)]">
          Gite su questo percorso
        </p>
        {canRegister ? (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg border border-[color:var(--hmr-accent)]/50 px-2 py-0.5 text-[10px] text-[color:var(--hmr-accent)]"
          >
            {showForm ? "Annulla" : "+ Nuova gita"}
          </button>
        ) : null}
      </div>

      <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
        Il percorso è la traccia riusabile; ogni gita registra data, neve e compagni.
      </p>

      {busy ? (
        <p className="mt-2 text-xs text-[color:var(--hmr-muted)]">Carico gite…</p>
      ) : outings.length === 0 ? (
        <p className="mt-2 text-xs text-[color:var(--hmr-muted)]">Nessuna gita registrata.</p>
      ) : (
        <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
          {outings.map((o) => (
            <li
              key={o.id}
              className="rounded-lg border border-[color:var(--hmr-border)]/50 bg-[color:var(--hmr-bg)]/40 px-2 py-1.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium">{o.title}</span>
                <span className="shrink-0 text-[10px] text-[color:var(--hmr-muted)]">
                  {formatOutingDate(o.outing_date)}
                </span>
              </div>
              {o.snow_notes ? (
                <p className="mt-0.5 line-clamp-2 text-[10px] text-[color:var(--hmr-muted)]">
                  {o.snow_notes}
                </p>
              ) : null}
              {o.participants.length > 0 ? (
                <p className="mt-0.5 text-[10px] text-[color:var(--hmr-faint)]">
                  {o.participants.join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {showForm && canRegister ? (
        <div className="mt-2 space-y-2 border-t border-[color:var(--hmr-border)]/50 pt-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Titolo gita (default: ${routeName})`}
            className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1.5 text-xs"
          />
          <input
            type="date"
            value={outingDate}
            onChange={(e) => setOutingDate(e.target.value)}
            className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1.5 text-xs"
          />
          <textarea
            value={snowNotes}
            onChange={(e) => setSnowNotes(e.target.value)}
            rows={2}
            placeholder="Condizioni neve, valanghe, note…"
            className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1.5 text-xs"
          />
          <input
            type="text"
            value={participantsText}
            onChange={(e) => setParticipantsText(e.target.value)}
            placeholder="Compagni (username separati da virgola)"
            className="w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-bg)] px-2 py-1.5 text-xs"
          />
          {groups.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => {
                const on = selectedGroupIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() =>
                      setSelectedGroupIds((ids) =>
                        on ? ids.filter((id) => id !== g.id) : [...ids, g.id],
                      )
                    }
                    className={
                      on
                        ? "rounded-lg bg-[color:var(--hmr-accent)] px-2 py-0.5 text-[10px] text-[color:var(--hmr-bg)]"
                        : "rounded-lg border border-[color:var(--hmr-border)] px-2 py-0.5 text-[10px] text-[color:var(--hmr-muted)]"
                    }
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          ) : null}
          <button
            type="button"
            disabled={saveBusy}
            onClick={() => void submitOuting()}
            className="w-full rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
          >
            {saveBusy ? "Registro…" : "Registra gita"}
          </button>
        </div>
      ) : null}

      {err ? <p className="mt-2 text-xs text-red-400">{err}</p> : null}
    </section>
  );
}
