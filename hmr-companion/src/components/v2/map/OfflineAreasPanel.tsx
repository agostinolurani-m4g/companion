"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "@/components/v2/ui/Icon";
import {
  bestMaxZoom,
  estimateArea,
  formatBytes,
  OFM_TILEJSON,
  offlineUrls,
  type OfflineArea,
  type OfflineBbox,
} from "@/lib/offline/area";

type Progress = { id: string; done: number; total: number; bytes: number };

type SwMessage =
  | { type: "OFFLINE_AREAS"; areas: OfflineArea[]; downloading: string | null }
  | { type: "OFFLINE_PROGRESS"; id: string; done: number; total: number; bytes: number }
  | { type: "OFFLINE_DONE"; id: string; failed: number; bytes: number; areas: OfflineArea[] }
  | { type: "OFFLINE_CANCELLED"; id: string; areas: OfflineArea[] }
  | { type: "OFFLINE_BUSY"; id: string };

function post(msg: unknown) {
  navigator.serviceWorker?.controller?.postMessage(msg);
}

/**
 * Mappe offline (stile Gaia / Mountain Maps): scarica l'area visibile — carta
 * vettoriale, rilievo e curve (DEM), nomi — e la rende usabile senza rete.
 */
export default function OfflineAreasPanel({
  getViewBbox,
  onFlyTo,
}: {
  getViewBbox: () => OfflineBbox | null;
  onFlyTo: (b: OfflineBbox) => void;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [areas, setAreas] = useState<OfflineArea[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [view, setView] = useState<OfflineBbox | null>(null);

  useEffect(() => {
    const ok = typeof navigator !== "undefined" && "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
    setSupported(ok);
    setView(getViewBbox());
    if (!ok) return;
    const onMsg = (ev: MessageEvent<SwMessage>) => {
      const d = ev.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "OFFLINE_AREAS") {
        setAreas(d.areas);
        if (!d.downloading) setProgress(null);
      } else if (d.type === "OFFLINE_PROGRESS") setProgress({ id: d.id, done: d.done, total: d.total, bytes: d.bytes });
      else if (d.type === "OFFLINE_DONE") {
        setAreas(d.areas);
        setProgress(null);
        setMsg(d.failed ? `Area salvata (${formatBytes(d.bytes)}), ${d.failed} file non scaricati: riprova online.` : `Area salvata: ${formatBytes(d.bytes)}.`);
      } else if (d.type === "OFFLINE_CANCELLED") {
        setAreas(d.areas);
        setProgress(null);
        setMsg("Download annullato.");
      } else if (d.type === "OFFLINE_BUSY") setMsg("C'è già un download in corso.");
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    post({ type: "OFFLINE_LIST" });
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [getViewBbox]);

  const plan = useMemo(() => {
    if (!view) return null;
    const maxZoom = bestMaxZoom(view);
    return { maxZoom, ...estimateArea(view, maxZoom) };
  }, [view]);

  const download = useCallback(async () => {
    const b = getViewBbox();
    if (!b) return;
    setMsg(null);
    try {
      const tj = (await fetch(OFM_TILEJSON).then((r) => r.json())) as { tiles?: string[] };
      const tpl = tj.tiles?.[0];
      if (!tpl) throw new Error("Catalogo della mappa non disponibile");
      const maxZoom = bestMaxZoom(b);
      const urls = offlineUrls(b, maxZoom, tpl);
      const id = `area-${Date.now().toString(36)}`;
      const label = name.trim() || `Area del ${new Date().toLocaleDateString("it-IT", { day: "numeric", month: "short" })}`;
      // Chiede al browser di non cancellare la cache quando lo spazio scarseggia.
      void navigator.storage?.persist?.().catch(() => false);
      setProgress({ id, done: 0, total: urls.length, bytes: 0 });
      post({ type: "OFFLINE_DOWNLOAD", area: { id, name: label, bbox: b, minZoom: 6, maxZoom }, urls });
      setName("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Download non riuscito");
    }
  }, [getViewBbox, name]);

  if (supported === false) {
    return (
      <p className="px-1 text-[11.5px] text-[color:var(--hmr-muted)]">
        Le mappe offline funzionano nell&apos;app pubblicata (HTTPS) dopo il primo caricamento. Ricarica la pagina se l&apos;hai
        appena aperta.
      </p>
    );
  }

  return (
    <div className="space-y-2 px-1 text-[12px]">
      {plan ? (
        <p className="text-[11.5px] text-[color:var(--hmr-muted)]">
          Area visibile: ~{formatBytes(plan.bytes)} · dettaglio fino a z{plan.maxZoom}
          {plan.maxZoom < 14 ? " (avvicina la mappa per più dettaglio)" : ""}
        </p>
      ) : null}
      {progress ? (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--hmr-border)]">
            <div className="h-full bg-[color:var(--hmr-accent)] transition-[width]" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-[color:var(--hmr-muted)]">
            <span>
              {progress.done}/{progress.total} file · {formatBytes(progress.bytes)}
            </span>
            <button type="button" className="text-[color:var(--hmr-danger)]" onClick={() => post({ type: "OFFLINE_CANCEL" })}>
              Annulla
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome (es. Valchiavenna)"
            className="min-w-0 flex-1 rounded-lg border border-[color:var(--hmr-border)] bg-transparent px-2 py-1.5 text-[12px]"
          />
          <button type="button" className="ui-btn ui-btn-sm shrink-0" onClick={download}>
            <Icon name="download" size={14} /> Scarica
          </button>
        </div>
      )}
      {msg ? <p className="text-[11px] text-[color:var(--hmr-muted)]">{msg}</p> : null}
      {areas.length ? (
        <ul className="space-y-0.5">
          {areas.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 rounded-lg px-1 py-1 hover:bg-[color:var(--hmr-elev)]">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onFlyTo(a.bbox)}>
                <span className="block truncate font-medium">{a.name}</span>
                <span className="block text-[10.5px] text-[color:var(--hmr-faint)]">
                  {formatBytes(a.bytes)} · z{a.maxZoom} · {new Date(a.createdAt).toLocaleDateString("it-IT")}
                </span>
              </button>
              <button
                type="button"
                className="ui-icon-btn text-[color:var(--hmr-faint)] hover:text-[color:var(--hmr-danger)]"
                aria-label={`Elimina ${a.name}`}
                onClick={() => post({ type: "OFFLINE_DELETE", id: a.id })}
              >
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-[color:var(--hmr-faint)]">Nessuna area salvata. Inquadra la zona della gita e scaricala col Wi‑Fi.</p>
      )}
    </div>
  );
}
