"use client";

import { useEffect, useState } from "react";
import { usePlanner } from "@/context/PlannerProvider";

export function BrowserPanel() {
  const { browserUrl, setBrowserUrl, pendingBrowser, setPendingBrowser } = usePlanner();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (pendingBrowser) setOpen(true);
  }, [pendingBrowser]);

  const safeOpen = (url: string) => {
    let u = url.trim();
    if (!u) return;
    if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      setBrowserUrl(parsed.toString());
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="shrink-0 overflow-hidden rounded-lg border border-zinc-700/50 bg-zinc-900/40">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">
          Anteprima web
          {pendingBrowser ? (
            <span className="ml-1 text-amber-300/90">· link in attesa</span>
          ) : (
            <span className="ml-1 text-zinc-600">(opzionale)</span>
          )}
        </span>
        <span className="shrink-0 text-zinc-500">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <>
          <div className="flex items-center gap-2 border-t border-zinc-700/50 px-2 py-1.5">
            <input
              className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://…"
            />
            <button
              type="button"
              className="shrink-0 rounded bg-zinc-700 px-2 py-1 text-xs text-white hover:bg-zinc-600"
              onClick={() => safeOpen(draft)}
            >
              Apri
            </button>
          </div>
          {pendingBrowser && (
            <div className="flex items-center justify-between gap-2 border-t border-amber-900/50 bg-amber-950/40 px-2 py-1.5 text-xs">
              <span className="truncate text-amber-100" title={pendingBrowser.url}>
                {pendingBrowser.title ?? "Link proposto"}: {pendingBrowser.url}
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-500"
                  onClick={() => {
                    safeOpen(pendingBrowser.url);
                    setPendingBrowser(null);
                  }}
                >
                  Conferma
                </button>
                <button
                  type="button"
                  className="rounded bg-zinc-700 px-2 py-0.5 text-zinc-200"
                  onClick={() => setPendingBrowser(null)}
                >
                  Ignora
                </button>
              </div>
            </div>
          )}
          <iframe
            title="Anteprima"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="h-[min(200px,35vh)] w-full border-t border-zinc-700/50 bg-white"
            src={browserUrl || "about:blank"}
          />
        </>
      )}
    </div>
  );
}
