"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlanner } from "@/context/PlannerProvider";
import type { PlannerToolEvent } from "@/lib/claude-planner";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatPanel() {
  const {
    sessionId,
    activeItineraryId,
    selectItinerary,
    loadItineraries,
    setPendingBrowser,
    setDraftEmail,
    setWindyOverlay,
  } = usePlanner();
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  /** Testo ragionamento + log tool mentre la risposta è in arrivo */
  const [liveTrace, setLiveTrace] = useState("");

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      const res = await fetch(`/api/chat/messages?sessionId=${encodeURIComponent(sessionId)}`);
      const j = (await res.json()) as { messages: { role: string; content: string }[] };
      setMsgs(
        j.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      );
    })();
  }, [sessionId]);

  const applySideEffects = useCallback(
    (events: PlannerToolEvent[]) => {
      for (const ev of events) {
        if (ev.kind === "browser_url") {
          setPendingBrowser({ url: ev.url, title: ev.title });
        }
        if (ev.kind === "draft_email") {
          setDraftEmail({ to: ev.to, subject: ev.subject, body: ev.body });
        }
        if (ev.kind === "weather_overlay") {
          setWindyOverlay({ lat: ev.lat, lng: ev.lng, zoom: ev.zoom });
        }
      }
    },
    [setDraftEmail, setPendingBrowser, setWindyOverlay]
  );

  const refreshMapAfterChat = useCallback(
    async (preferredItineraryId: string | null | undefined) => {
      await loadItineraries();
      const id = preferredItineraryId ?? activeItineraryId;
      if (id) {
        await selectItinerary(id);
      }
    },
    [activeItineraryId, loadItineraries, selectItinerary]
  );

  const send = async () => {
    const t = input.trim();
    if (!t || !sessionId || loading) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setLoading(true);
    setLiveTrace("");
    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          itineraryId: activeItineraryId,
          message: t,
        }),
      });

      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setMsgs((m) => [...m, { role: "assistant", content: j.error ?? `Errore HTTP ${res.status}` }]);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      let finalReply = "";
      let events: PlannerToolEvent[] = [];
      let activeId: string | null | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += dec.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            let data: unknown;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            const o = data as {
              type?: string;
              kind?: string;
              text?: string;
              name?: string;
              inputSummary?: string;
              reply?: string;
              events?: PlannerToolEvent[];
              activeItineraryId?: string | null;
              message?: string;
            };
            if (o.type === "progress") {
              if (o.kind === "assistant_text" && typeof o.text === "string") {
                setLiveTrace((prev) => prev + (prev ? "\n\n" : "") + o.text);
              }
              if (o.kind === "tool" && o.name) {
                setLiveTrace(
                  (prev) =>
                    prev +
                    `\n→ ${o.name}: ${typeof o.inputSummary === "string" ? o.inputSummary : ""}`
                );
              }
            }
            if (o.type === "complete") {
              finalReply = o.reply ?? "";
              events = o.events ?? [];
              activeId = o.activeItineraryId;
            }
            if (o.type === "error") {
              setMsgs((m) => [...m, { role: "assistant", content: o.message ?? "Errore stream" }]);
              return;
            }
          }
        }
        if (done) break;
      }

      setMsgs((m) => [...m, { role: "assistant", content: finalReply || "Fatto." }]);
      applySideEffects(events);
      await refreshMapAfterChat(activeId);
    } finally {
      setLoading(false);
      setLiveTrace("");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-700/50 bg-zinc-900/40">
      <div className="border-b border-zinc-700/50 px-3 py-2 text-xs font-medium text-zinc-400">
        Chat planner
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm">
        {msgs.length === 0 && (
          <p className="text-zinc-500">
            Descrivi il percorso. L’AI mostra qui sotto il ragionamento mentre usa i tool; la risposta finale
            arriva a fine turno.
          </p>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 rounded-lg bg-emerald-900/40 px-2 py-1.5 text-emerald-50"
                : "mr-8 rounded-lg bg-zinc-800/80 px-2 py-1.5 text-zinc-100"
            }
          >
            <span className="text-[10px] uppercase text-zinc-500">{m.role}</span>
            <p className="whitespace-pre-wrap">{m.content}</p>
          </div>
        ))}
        {loading && liveTrace && (
          <div className="mr-8 rounded-lg border border-amber-900/40 bg-amber-950/25 px-2 py-2 text-[11px] text-amber-100/95">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-400/90">
              In corso…
            </div>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-zinc-300">
              {liveTrace}
            </pre>
          </div>
        )}
        {loading && !liveTrace && <p className="text-xs text-zinc-500">Connessione…</p>}
      </div>
      <div className="flex gap-2 border-t border-zinc-700/50 p-2">
        <textarea
          className="min-h-[72px] flex-1 resize-none rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
          placeholder="Messaggio…"
          value={input}
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
          className="self-end rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          Invia
        </button>
      </div>
    </div>
  );
}
