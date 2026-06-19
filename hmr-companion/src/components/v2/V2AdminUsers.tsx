"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import V2Nav from "@/components/v2/V2Nav";
import type { AppUserRole } from "@/lib/db";

type UserRow = {
  username: string;
  role: AppUserRole;
  active: boolean;
  created_at: number;
};

export default function V2AdminUsers() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppUserRole>("user");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/v2/admin/users");
      const data = (await res.json()) as { error?: string; users?: UserRow[] };
      if (!res.ok) throw new Error(data.error ?? "Caricamento fallito");
      setUsers(data.users ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      const res = await fetch("/api/v2/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role, active: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Creazione fallita");
      setUsername("");
      setPassword("");
      setRole("user");
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const patchUser = async (u: UserRow, patch: { role?: AppUserRole; active?: boolean; password?: string }) => {
    setErr(null);
    try {
      const res = await fetch(`/api/v2/admin/users/${encodeURIComponent(u.username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Aggiornamento fallito");
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteUser = async (u: UserRow) => {
    if (!window.confirm(`Eliminare utente "${u.username}"?`)) return;
    setErr(null);
    try {
      const res = await fetch(`/api/v2/admin/users/${encodeURIComponent(u.username)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Eliminazione fallita");
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <V2Nav isAdmin />
      <div className="mx-auto w-full max-w-3xl flex-1 p-4">
        <h1 className="text-xl font-semibold">Admin utenti</h1>
        <p className="mt-1 text-sm text-[color:var(--hmr-muted)]">
          Crea e gestisci gli account HMR Companion.
        </p>

        <form
          onSubmit={(e) => void onCreate(e)}
          className="hmr-panel mt-4 grid gap-3 rounded-2xl border border-[color:var(--hmr-border)]/80 p-4 sm:grid-cols-2"
        >
          <h2 className="sm:col-span-2 text-sm font-medium">Nuovo utente</h2>
          <label className="text-xs">
            <span className="text-[color:var(--hmr-muted)]">Username</span>
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-[color:var(--hmr-muted)]">Password</span>
            <input
              required
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-[color:var(--hmr-muted)]">Ruolo</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppUserRole)}
              className="mt-1 w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-2 text-sm"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={creating}
            className="self-end rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-medium text-[color:var(--hmr-bg)] disabled:opacity-50"
          >
            {creating ? "Creo…" : "Crea utente"}
          </button>
        </form>

        <section className="mt-6">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-[color:var(--hmr-muted)]">
            Utenti ({users.length})
          </h2>
          {busy ? (
            <p className="text-sm text-[color:var(--hmr-muted)]">Caricamento…</p>
          ) : (
            <ul className="grid gap-2">
              {users.map((u) => (
                <li
                  key={u.username}
                  className="hmr-panel flex flex-col gap-2 rounded-xl border border-[color:var(--hmr-border)]/80 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{u.username}</p>
                    <p className="text-xs text-[color:var(--hmr-muted)]">
                      {u.role} · {u.active ? "attivo" : "disabilitato"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void patchUser(u, { role: u.role === "admin" ? "user" : "admin" })}
                      className="rounded-lg border border-[color:var(--hmr-border)] px-2 py-1 text-[11px]"
                    >
                      {u.role === "admin" ? "→ user" : "→ admin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void patchUser(u, { active: !u.active })}
                      className="rounded-lg border border-[color:var(--hmr-border)] px-2 py-1 text-[11px]"
                    >
                      {u.active ? "Disabilita" : "Abilita"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const pwd = window.prompt(`Nuova password per ${u.username} (min 6 caratteri):`);
                        if (pwd && pwd.length >= 6) void patchUser(u, { password: pwd });
                      }}
                      className="rounded-lg border border-[color:var(--hmr-border)] px-2 py-1 text-[11px]"
                    >
                      Reset pwd
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteUser(u)}
                      className="rounded-lg border border-red-500/40 px-2 py-1 text-[11px] text-red-400"
                    >
                      Elimina
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {err ? <p className="mt-4 text-xs text-red-400">{err}</p> : null}
      </div>
    </div>
  );
}
