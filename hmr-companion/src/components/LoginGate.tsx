"use client";

import { useState, type FormEvent } from "react";

export default function LoginGate() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Accesso non riuscito");
      window.location.assign("/");
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex h-full items-center justify-center p-4">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="hmr-panel w-full max-w-sm rounded-2xl border border-[color:var(--hmr-border)]/80 p-4"
      >
        <h1 className="text-lg font-semibold">Accedi a HMR Companion</h1>
        <p className="mt-1 text-xs text-[color:var(--hmr-muted)]">
          Nome utente e password predefiniti (non modificabili dall&apos;app).
        </p>
        <label className="mt-3 block text-xs text-[color:var(--hmr-muted)]">
          Nome utente
          <input
            type="text"
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 text-sm"
            placeholder="es. ago"
          />
        </label>
        <label className="mt-3 block text-xs text-[color:var(--hmr-muted)]">
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="hmr-btn hmr-btn-accent hmr-tap mt-3 w-full justify-center text-sm"
        >
          {busy ? "Accesso..." : "Accedi"}
        </button>
        {err && <p className="mt-2 text-xs text-[color:var(--hmr-danger)]">{err}</p>}
      </form>
    </main>
  );
}
