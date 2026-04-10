"use client";

import { useCallback, useEffect, useState } from "react";

type Msg = { role: string; content: string };
type Artifact = {
  id: number;
  kind: string;
  title: string | null;
  created_at: string;
  payload: unknown;
};

const STORAGE_KEY = "studio_session_id";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadArtifacts = useCallback(async (sid: string) => {
    const r = await fetch(`/api/artifacts?sessionId=${encodeURIComponent(sid)}`);
    if (!r.ok) return;
    const j = (await r.json()) as { items: Artifact[] };
    setArtifacts(j.items ?? []);
  }, []);

  const loadMessages = useCallback(async (sid: string) => {
    const r = await fetch(`/api/messages?sessionId=${encodeURIComponent(sid)}`);
    if (!r.ok) return;
    const j = (await r.json()) as { messages: Msg[] };
    setMessages(j.messages ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_KEY) : null;
      if (saved) {
        setSessionId(saved);
        await loadMessages(saved);
        await loadArtifacts(saved);
        return;
      }
      const r = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok || cancelled) return;
      const s = (await r.json()) as { id: string };
      sessionStorage.setItem(STORAGE_KEY, s.id);
      setSessionId(s.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMessages, loadArtifacts]);

  async function send() {
    const text = input.trim();
    if (!text || !sessionId || loading) return;
    setInput("");
    setError(null);
    setLoading(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Errore");
      const reply = String(j.reply ?? "");
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      await loadArtifacts(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  const baseOut =
    sessionId && typeof window !== "undefined"
      ? `${window.location.origin}/output/${sessionId}`
      : null;
  const previewUrl = baseOut ? `${baseOut}/index.html` : null;
  const presentationUrl = baseOut ? `${baseOut}/presentation/index.html` : null;

  return (
    <div className="flex min-h-full flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold tracking-tight">Studio Builder</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Brand, strategia e bozza sito (bozze — nessuna consulenza legale/finanziaria). Ricerca web attiva se abilitata in Console Anthropic. Solo SQLite locale, niente MongoDB.
        </p>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 md:flex-row">
        <section className="flex flex-1 flex-col rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="max-h-[60vh] flex-1 space-y-3 overflow-y-auto p-4 md:max-h-[calc(100vh-12rem)]">
            {messages.length === 0 && (
              <p className="text-sm text-zinc-500">
                Descrivi attività, nome brand, prodotti. Puoi chiedere brand, sito, o una presentazione slide (Reveal).
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-8 bg-emerald-600 text-white"
                    : "mr-8 bg-zinc-100 dark:bg-zinc-800"
                }`}
              >
                <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
              </div>
            ))}
            {loading && <p className="text-sm text-zinc-500">Claude sta lavorando…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <textarea
              className="mb-2 min-h-[88px] w-full resize-y rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
              placeholder="Scrivi un messaggio…"
              value={input}
              disabled={loading || !sessionId}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !sessionId}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Invia
            </button>
          </div>
        </section>

        <aside className="flex w-full flex-col gap-3 md:w-80">
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-medium">Anteprima sito</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Si apre dopo che il modello ha creato <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">index.html</code>.
            </p>
            {previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-emerald-700 underline dark:text-emerald-400"
              >
                Apri sito (index.html)
              </a>
            )}
            {presentationUrl && (
              <a
                href={presentationUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-emerald-700 underline dark:text-emerald-400"
              >
                Apri presentazione (slide)
              </a>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-medium">Artefatti</h2>
            {artifacts.length === 0 ? (
              <p className="mt-2 text-zinc-500">Nessun artefatto salvato.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {artifacts.map((a) => (
                  <li key={a.id} className="rounded border border-zinc-100 p-2 dark:border-zinc-800">
                    <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">{a.kind}</span>
                    {a.title && <div className="text-xs font-medium">{a.title}</div>}
                    <pre className="mt-1 max-h-24 overflow-auto text-xs text-zinc-600 dark:text-zinc-400">
                      {JSON.stringify(a.payload, null, 2).slice(0, 500)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            Immagini da URL: verifica sempre licenze e diritti. Sessione:{" "}
            <span className="font-mono">{sessionId?.slice(0, 8)}…</span>
          </p>
        </aside>
      </div>
    </div>
  );
}
