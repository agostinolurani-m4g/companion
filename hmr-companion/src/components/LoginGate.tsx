"use client";

import { useState, type FormEvent } from "react";
import { BrandMark } from "@/components/v2/V2Shell";

const AMARO_ERRORS: Readonly<Record<string, string>> = {
  invalid: "Accesso da Amaro scaduto o non valido: riprova dall'area tesserati.",
  inactive: "Tessera Amaro non attiva: completa il tesseramento per entrare.",
  unreachable: "Il sito Amaro non risponde: riprova tra poco.",
  disabled: "Il tuo accesso a Companion è stato disattivato.",
};

export default function LoginGate({ amaroError }: { amaroError?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(
    amaroError ? (AMARO_ERRORS[amaroError] ?? AMARO_ERRORS.invalid) : null
  );

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
    <main className="v2-theme flex h-full items-center justify-center p-4">
      <form onSubmit={(e) => void onSubmit(e)} className="w-full max-w-[360px]">
        <div className="flex items-center gap-2.5">
          <BrandMark size={28} />
          <span className="text-[15px] font-semibold tracking-tight">HMR Companion</span>
        </div>

        <h1 className="mt-10 text-[26px] font-semibold tracking-tight">Accedi</h1>
        <p className="mt-1 text-[14px] text-[color:var(--hmr-muted)]">Pianifica, esplora, torna a casa.</p>

        <label className="mt-8 block">
          <span className="text-[13px] font-medium">Nome utente</span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="ui-input mt-1.5 !min-h-[44px]"
          />
        </label>
        <label className="mt-4 block">
          <span className="text-[13px] font-medium">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="ui-input mt-1.5 !min-h-[44px]"
          />
        </label>
        {err ? (
          <p className="mt-4 text-[13px] text-[color:var(--hmr-danger)]" role="alert">
            {err}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className="ui-btn ui-btn-primary mt-6 !min-h-[44px] w-full !text-[14px]">
          {busy ? "Accesso…" : "Accedi"}
        </button>

        <div className="mt-6 border-t border-[color:var(--hmr-border)] pt-6">
          <a href="/api/auth/amaro/start" className="ui-btn !min-h-[44px] w-full !text-[14px]">
            Entra come tesserato Amaro
          </a>
          <p className="mt-2 text-[12px] text-[color:var(--hmr-muted)]">
            Passi dall&apos;area tesserati di amarobici.it: nessun&apos;altra password.
          </p>
        </div>
      </form>
    </main>
  );
}
