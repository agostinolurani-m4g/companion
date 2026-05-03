"use client";

import { useCallback, useEffect, useState } from "react";

type Bbox = { minLng: number; maxLng: number; minLat: number; maxLat: number };

type Props = {
  trackId: string;
  bbox: Bbox;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function OfflineStatus({ trackId, bbox }: Props) {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [quota, setQuota] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prefetchMsg, setPrefetchMsg] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const ua = window.navigator.userAgent.toLowerCase();
    const iOS =
      /iphone|ipad|ipod/.test(ua) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

    setIsIos(iOS);
    setIsStandalone(standalone);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBeforeInstallPrompt = (ev: Event) => {
      ev.preventDefault();
      setInstallPrompt(ev as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const refreshQuota = useCallback(async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est && typeof est.usage === "number" && typeof est.quota === "number") {
        setQuota(`${formatBytes(est.usage)} / ${formatBytes(est.quota)}`);
      } else setQuota(null);
    } catch {
      setQuota(null);
    }
  }, []);

  useEffect(() => {
    void refreshQuota();
    const id = window.setInterval(() => void refreshQuota(), 8000);
    return () => window.clearInterval(id);
  }, [open, refreshQuota]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "PREFETCH_PROGRESS") {
        setPrefetchMsg(`Tile… ${d.done}/${d.max}`);
      }
      if (d.type === "PREFETCH_DONE") {
        setBusy(false);
        setPrefetchMsg(`Tile in cache: ${d.done} (falliti: ${d.failed})`);
        void refreshQuota();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [refreshQuota]);

  const warmApis = useCallback(async () => {
    const base = `/api/track/${encodeURIComponent(trackId)}`;
    const urls = [
      "/api/track/default",
      `${base}`,
      `${base}/checkpoints`,
      `${base}/resupply`,
      `${base}/sections`,
      `${base}/surface-segments`,
    ];
    await Promise.all(urls.map((u) => fetch(u, { credentials: "same-origin" }).catch(() => null)));
  }, [trackId]);

  const onPrefetchTiles = useCallback(async () => {
    setPrefetchMsg(null);
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.active) {
      setBusy(false);
      setPrefetchMsg("Service Worker non attivo (usa build produzione + HTTPS).");
      return;
    }
    setBusy(true);
    setPrefetchMsg("Tile…");
    reg.active.postMessage({
      type: "PREFETCH_TILES",
      bbox,
      zooms: [12, 13, 14],
      maxTiles: 400,
    });
  }, [bbox]);

  const onPrepareOffline = useCallback(async () => {
    setBusy(true);
    setPrefetchMsg("Scarico API…");
    try {
      await warmApis();
      setPrefetchMsg("API in cache. Avvio tile…");
      await onPrefetchTiles();
    } catch {
      setBusy(false);
      setPrefetchMsg("Errore durante la preparazione.");
    }
  }, [onPrefetchTiles, warmApis]);

  const onInstallApp = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }, [installPrompt]);

  return (
    <div className="pointer-events-auto absolute bottom-[calc(var(--safe-bottom)+5.5rem)] left-3 z-30 md:bottom-[calc(var(--safe-bottom)+1rem)]">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          void refreshQuota();
        }}
        className="hmr-panel hmr-tap rounded-full border border-[color:var(--hmr-border)]/90 px-3 py-1.5 text-[11px] font-medium shadow-lg"
        aria-expanded={open}
      >
        {online ? "📶 Online" : "✈️ Offline"}
      </button>
      {open && (
        <div className="hmr-panel mt-2 w-[min(20rem,calc(100vw-1.5rem))] space-y-2 rounded-xl border border-[color:var(--hmr-border)]/80 p-3 text-xs shadow-xl">
          <p className="text-[color:var(--hmr-muted)]">
            Per la gara: con Wi‑Fi, tocca <strong>Prepara offline</strong> (API + tile OSM/Topo ~80–150 MB).
            Poi installa l’app sulla schermata Home.
          </p>
          {!isStandalone && installPrompt && (
            <button
              type="button"
              onClick={() => void onInstallApp()}
              className="hmr-btn hmr-btn-accent hmr-tap w-full text-[11px]"
            >
              Installa app
            </button>
          )}
          {!isStandalone && isIos && (
            <p className="text-[10px] text-[color:var(--hmr-faint)]">
              iPhone/iPad: in Safari tocca <strong>Condividi</strong> e poi{" "}
              <strong>Aggiungi a Home</strong> (iOS non mostra il popup automatico di installazione).
            </p>
          )}
          {isStandalone && (
            <p className="text-[10px] text-[color:var(--hmr-faint)]">
              App installata: avviala dalla Home per avere esperienza fullscreen.
            </p>
          )}
          {quota && (
            <p className="text-[color:var(--hmr-faint)]">
              Storage: <span className="text-[color:var(--hmr-text)]">{quota}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onPrepareOffline()}
              className="hmr-btn hmr-btn-accent hmr-tap text-[11px]"
            >
              {busy ? "⏳ …" : "Prepara offline"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void warmApis().then(() => {
                  setPrefetchMsg("API aggiornate in cache.");
                })
              }
              className="hmr-btn hmr-tap text-[11px]"
            >
              Solo API
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onPrefetchTiles()}
              className="hmr-btn hmr-tap text-[11px]"
            >
              Solo tile
            </button>
          </div>
          {prefetchMsg && <p className="text-[10px] text-[color:var(--hmr-muted)]">{prefetchMsg}</p>}
        </div>
      )}
    </div>
  );
}
