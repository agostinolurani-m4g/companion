"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlanner } from "@/context/PlannerProvider";
import type { PlannerToolEvent } from "@/lib/planner-events";
import { renderMarkdownLite } from "@/lib/chat-markdown-lite";

type Msg = { role: "user" | "assistant"; content: string };

const QUICK_PROMPTS: { label: string; text: string }[] = [
  {
    label: "Itinerario 2 giorni",
    text: "Proponi un itinerario escursionistico di 2 giorni in zona montagna, con tappe per pernottamento in rifugio e dislivello realistico.",
  },
  {
    label: "Rifugio sulla mappa",
    text: "Aggiungi una tappa rifugio (lodging) o un POI refuge con nome e coordinate sul mio itinerario attivo: i contatti e la foto si salvano da soli nel database.",
  },
  {
    label: "Meteo + tappe",
    text: "Controlla le previsioni meteo per le date del mio itinerario e suggerisci se conviene posticipare o cambiare tappa.",
  },
  {
    label: "Varianti percorso",
    text: "Crea due varianti del percorso (una più panoramica, una più veloce) e spiega pro e contro.",
  },
  {
    label: "Social sulla mappa",
    text: "Riassumi le uscite recenti visibili come amici (list_friend_outings) e spiega come vederle sulla mappa (tab Io e livello Social Amici).",
  },
  {
    label: "Ciclismo",
    text: "Pianifica un giro in bici da strada con waypoint intermedi lungo il percorso così il routing segue le strade.",
  },
];

export function ChatPanel() {
  const {
    sessionId,
    activeItineraryId,
    selectItinerary,
    loadItineraries,
    setPendingBrowser,
    setDraftEmail,
    setWindyOverlay,
    setMapPanelMode,
  } = usePlanner();
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  /** Testo ragionamento + log tool mentre la risposta è in arrivo */
  const [liveTrace, setLiveTrace] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [msgs, loading, liveTrace]);

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
        if (ev.kind === "map_panel") {
          setMapPanelMode(ev.mode);
        }
      }
    },
    [setDraftEmail, setMapPanelMode, setPendingBrowser, setWindyOverlay]
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

  const clearChat = useCallback(async () => {
    if (!sessionId || loading) return;
    const res = await fetch(
      `/api/chat/messages?sessionId=${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsgs((m) => [
        ...m,
        {
          role: "assistant" as const,
          content: j.error ?? `Impossibile svuotare la chat (${res.status})`,
        },
      ]);
      return;
    }
    setMsgs([]);
  }, [sessionId, loading]);

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
    <div className="tp-panel flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-brand-border/80 px-3 py-2.5">
        <span className="text-xs font-medium text-brand-muted">Assistente</span>
        <button
          type="button"
          title="Cancella tutti i messaggi di questa sessione"
          disabled={!sessionId || loading || msgs.length === 0}
          onClick={() => void clearChat()}
          className="shrink-0 rounded-lg border border-brand-border bg-brand-elevated px-2 py-1 text-[11px] font-medium text-brand-muted hover:border-brand-muted hover:text-brand-text disabled:pointer-events-none disabled:opacity-35"
        >
          Svuota
        </button>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm"
      >
        {msgs.length === 0 && (
          <div className="space-y-2 text-brand-muted">
            <p className="text-[13px] leading-relaxed text-brand-text/90">
              Scrivi cosa vuoi fare o tocca un suggerimento. Serve un{" "}
              <strong className="font-medium text-brand-text">itinerario selezionato</strong> in alto per salvare tappe
              e mappa.
            </p>
            <p className="text-[11px] leading-relaxed">
              Mentre l’assistente lavora vedi il riepilogo qui sotto; la risposta completa arriva a fine turno.
            </p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 rounded-lg bg-brand-accent-dim px-2 py-1.5 text-brand-text ring-1 ring-brand-accent/20"
                : "mr-8 rounded-lg bg-brand-elevated px-2 py-1.5 text-brand-text ring-1 ring-brand-border/60"
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase text-brand-faint">{m.role}</span>
              {m.role === "assistant" ? (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[10px] text-brand-faint hover:bg-brand-border/50 hover:text-brand-text"
                  title="Copia messaggio"
                  onClick={() => void navigator.clipboard.writeText(m.content)}
                >
                  Copia
                </button>
              ) : null}
            </div>
            <p className="whitespace-pre-wrap">{renderMarkdownLite(m.content, `m${i}`)}</p>
          </div>
        ))}
        {loading && liveTrace && (
          <div className="mr-8 rounded-lg border border-amber-900/40 bg-amber-950/25 px-2 py-2 text-[11px] text-amber-100/95">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-400/90">
              In corso…
            </div>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-brand-muted">
              {liveTrace}
            </pre>
          </div>
        )}
        {loading && !liveTrace && (
          <p className="text-xs text-brand-muted">Connessione…</p>
        )}
      </div>
      <div className="flex flex-wrap gap-1 border-t border-brand-border/60 px-2 pt-2">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={loading || !sessionId}
            title={q.text}
            className="rounded-full border border-brand-border bg-brand-elevated px-2 py-0.5 text-[10px] text-brand-muted hover:border-brand-accent/40 hover:text-brand-accent disabled:opacity-40"
            onClick={() => setInput(q.text)}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 border-t border-brand-border/80 p-2">
        <textarea
          className="min-h-[72px] flex-1 resize-none rounded-lg border border-brand-border bg-brand-bg px-2 py-1.5 text-sm text-brand-text placeholder:text-brand-faint focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
          placeholder="Chiedi un itinerario, una tappa, la meteo…"
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
          className="self-end rounded-lg bg-brand-accent px-3 py-1.5 text-sm font-medium text-brand-bg hover:brightness-110 disabled:opacity-40"
        >
          Invia
        </button>
      </div>
    </div>
  );
}
