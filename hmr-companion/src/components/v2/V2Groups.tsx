"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import V2Nav from "@/components/v2/V2Nav";
import type { GroupType } from "@/lib/db";

type Props = {
  username: string;
  isAdmin?: boolean;
};

type GroupSummary = {
  id: string;
  name: string;
  type: GroupType;
  type_label: string;
  description: string;
  member_count: number;
  last_message: { from_user: string; body: string; created_at: number } | null;
  updated_at: number;
};

type FollowingProfile = {
  username: string;
  display_name: string;
};

const GROUP_TYPES: { value: GroupType; label: string }[] = [
  { value: "friends", label: "Amici" },
  { value: "club", label: "Club / CAI" },
  { value: "trip", label: "Gita" },
  { value: "custom", label: "Altro" },
];

function groupInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export default function V2Groups({ username, isAdmin = false }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteUser = searchParams.get("invite")?.trim().toLowerCase() ?? "";

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [following, setFollowing] = useState<FollowingProfile[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(!!inviteUser);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "friends" as GroupType,
    description: "",
    members: inviteUser ? [inviteUser] : ([] as string[]),
    memberInput: "",
  });

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const [gRes, fRes] = await Promise.all([
        fetch("/api/v2/groups"),
        fetch("/api/v2/follow"),
      ]);
      const gData = (await gRes.json()) as { error?: string; groups?: GroupSummary[] };
      const fData = (await fRes.json()) as { error?: string; following?: FollowingProfile[] };
      if (!gRes.ok) throw new Error(gData.error ?? "Caricamento gruppi fallito");
      setGroups(gData.groups ?? []);
      if (fRes.ok) setFollowing(fData.following ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleMember = (u: string) => {
    setForm((f) => ({
      ...f,
      members: f.members.includes(u) ? f.members.filter((x) => x !== u) : [...f.members, u],
    }));
  };

  const addMemberInput = () => {
    const u = form.memberInput.trim().toLowerCase();
    if (!u || form.members.includes(u)) return;
    setForm((f) => ({ ...f, members: [...f.members, u], memberInput: "" }));
  };

  const createGroup = async () => {
    const name = form.name.trim();
    if (!name) {
      setErr("Inserisci un nome per il gruppo");
      return;
    }
    setCreating(true);
    setErr(null);
    try {
      const res = await fetch("/api/v2/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: form.type,
          description: form.description,
          members: form.members,
        }),
      });
      const data = (await res.json()) as { error?: string; group?: { id: string } };
      if (!res.ok) throw new Error(data.error ?? "Creazione fallita");
      setShowCreate(false);
      setForm({ name: "", type: "friends", description: "", members: [], memberInput: "" });
      router.push(`/v2/groups/${encodeURIComponent(data.group?.id ?? "")}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="mx-auto w-full max-w-3xl flex-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Gruppi</h1>
            <p className="mt-1 text-sm text-[color:var(--hmr-muted)]">
              Cerchi di amici, sezioni CAI o gruppi per una gita.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="shrink-0 rounded-lg bg-[color:var(--hmr-accent)] px-3 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
          >
            + Nuovo gruppo
          </button>
        </div>

        {showCreate ? (
          <div className="mt-4 hmr-panel rounded-2xl border border-[color:var(--hmr-border)]/80 p-4">
            <h2 className="text-sm font-medium">Crea un gruppo</h2>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-xs">
                Nome
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="es. Scialpinisti del bar"
                  className="rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs">
                Tipo
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as GroupType }))}
                  className="rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
                >
                  {GROUP_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs">
                Descrizione (opzionale)
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
                />
              </label>

              {following.length > 0 ? (
                <div className="grid gap-1 text-xs">
                  <span>Invita chi segui</span>
                  <div className="flex flex-wrap gap-2">
                    {following.map((p) => (
                      <button
                        key={p.username}
                        type="button"
                        onClick={() => toggleMember(p.username)}
                        className={
                          form.members.includes(p.username)
                            ? "rounded-full bg-[color:var(--hmr-accent)] px-2.5 py-1 text-[10px] text-[color:var(--hmr-bg)]"
                            : "rounded-full border border-[color:var(--hmr-border)] px-2.5 py-1 text-[10px]"
                        }
                      >
                        {p.display_name || p.username}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-1 text-xs">
                <span>Aggiungi per username</span>
                <div className="flex gap-2">
                  <input
                    value={form.memberInput}
                    onChange={(e) => setForm((f) => ({ ...f, memberInput: e.target.value }))}
                    placeholder="es. ale"
                    className="min-w-0 flex-1 rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-3 py-2 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addMemberInput();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={addMemberInput}
                    className="rounded-lg border border-[color:var(--hmr-border)] px-3 py-2 text-xs"
                  >
                    Aggiungi
                  </button>
                </div>
                {form.members.length > 0 ? (
                  <p className="text-[color:var(--hmr-muted)]">
                    Membri: {form.members.map((m) => `@${m}`).join(", ")}
                  </p>
                ) : null}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => void createGroup()}
                  className="rounded-lg bg-[color:var(--hmr-accent)] px-4 py-2 text-xs font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
                >
                  {creating ? "Creo…" : "Crea gruppo"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-[color:var(--hmr-border)] px-4 py-2 text-xs"
                >
                  Annulla
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {busy ? (
          <p className="mt-6 text-sm text-[color:var(--hmr-muted)]">Caricamento…</p>
        ) : groups.length === 0 ? (
          <p className="mt-6 text-sm text-[color:var(--hmr-muted)]">
            Nessun gruppo ancora. Crea il primo cerchio!
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/v2/groups/${encodeURIComponent(g.id)}`}
                  className="hmr-panel flex items-center gap-3 rounded-2xl border border-[color:var(--hmr-border)]/80 p-4 hover:border-[color:var(--hmr-accent)]/40"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:var(--hmr-accent)]/20 text-lg font-semibold text-[color:var(--hmr-accent)]">
                    {groupInitial(g.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{g.name}</span>
                      <span className="shrink-0 rounded-full bg-[color:var(--hmr-faint)]/20 px-2 py-0.5 text-[10px] text-[color:var(--hmr-muted)]">
                        {g.type_label}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[color:var(--hmr-muted)]">
                      {g.last_message
                        ? `${g.last_message.from_user}: ${g.last_message.body}`
                        : `${g.member_count} membri · nessun messaggio`}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-[color:var(--hmr-muted)]">
                    {formatTime(g.last_message?.created_at ?? g.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {err ? <p className="mt-4 text-xs text-red-400">{err}</p> : null}
      </div>
    </div>
  );
}
