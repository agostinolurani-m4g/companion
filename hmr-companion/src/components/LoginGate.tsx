"use client";

import { useState, type FormEvent } from "react";

export default function LoginGate() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Errore invio email");
      setMsg("Link inviato. Controlla la casella email.");
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
          Inserisci la tua email autorizzata per ricevere un link di accesso.
        </p>
        <label className="mt-3 block text-xs text-[color:var(--hmr-muted)]">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 text-sm"
            placeholder="nome@email.com"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="hmr-btn hmr-btn-accent hmr-tap mt-3 w-full justify-center text-sm"
        >
          {busy ? "Invio..." : "Invia link di accesso"}
        </button>
        {msg && <p className="mt-2 text-xs text-emerald-300">{msg}</p>}
        {err && <p className="mt-2 text-xs text-[color:var(--hmr-danger)]">{err}</p>}
      </form>
    </main>
  );
}
