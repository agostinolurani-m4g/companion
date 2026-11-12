"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type PanelSnap = "peek" | "half" | "full";

/** Larghezza pannello desktop (agganciato a sinistra). */
export const DESKTOP_PANEL_W = 384;

type Props = {
  /** Sempre visibile (anche in "peek" su mobile): ricerca, statistiche. */
  header: ReactNode;
  children: ReactNode;
  /** Footer fisso in fondo (solo desktop: su mobile mettilo nel contenuto). */
  footer?: ReactNode;
  snap: PanelSnap;
  onSnapChange: (s: PanelSnap) => void;
  /** Altezza in px del contenuto "peek" su mobile. */
  peekHeight?: number;
  /** Notifica l'altezza visibile del foglio (mobile) per posizionare overlay sopra. */
  onMobileHeight?: (px: number) => void;
};

const SNAP_ORDER: PanelSnap[] = ["peek", "half", "full"];

function useIsDesktop() {
  const [desk, setDesk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desk;
}

/**
 * Pannello mappa: colonna agganciata a sinistra su desktop, foglio inferiore
 * con tre altezze (peek / metà / pieno) e trascinamento su mobile.
 */
export default function MapPanel({ header, children, footer, snap, onSnapChange, peekHeight = 168, onMobileHeight }: Props) {
  const isDesktop = useIsDesktop();
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  const [parentH, setParentH] = useState(0);

  useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => setParentH(parent.clientHeight));
    ro.observe(parent);
    setParentH(parent.clientHeight);
    return () => ro.disconnect();
  }, [isDesktop]);

  const heightFor = useCallback(
    (s: PanelSnap) => {
      const max = Math.max(peekHeight + 40, parentH);
      if (s === "peek") return Math.min(peekHeight, max);
      if (s === "half") return Math.min(Math.round(parentH * 0.52), max);
      return max;
    },
    [parentH, peekHeight],
  );

  const height = dragH ?? heightFor(snap);

  // Notifica solo a foglio fermo (niente ricalcoli camera durante il drag).
  useEffect(() => {
    if (dragH != null) return;
    if (!isDesktop) onMobileHeight?.(height);
    else onMobileHeight?.(0);
  }, [height, isDesktop, onMobileHeight, dragH]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (isDesktop) return;
    dragRef.current = { startY: e.clientY, startH: height };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setDragH(Math.max(heightFor("peek") - 30, Math.min(heightFor("full"), d.startH + (d.startY - e.clientY))));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const moved = Math.abs(e.clientY - d.startY);
    const current = dragH ?? height;
    setDragH(null);
    if (moved < 6) {
      const idx = SNAP_ORDER.indexOf(snap);
      onSnapChange(SNAP_ORDER[(idx + 1) % SNAP_ORDER.length]);
      return;
    }
    let best: PanelSnap = "peek";
    let bestD = Infinity;
    for (const s of SNAP_ORDER) {
      const dd = Math.abs(heightFor(s) - current);
      if (dd < bestD) {
        bestD = dd;
        best = s;
      }
    }
    onSnapChange(best);
  };

  if (isDesktop) {
    return (
      <div
        ref={rootRef}
        className="absolute inset-y-0 left-0 z-30 flex flex-col border-r border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)]"
        style={{ width: DESKTOP_PANEL_W }}
      >
        <div className="shrink-0 px-5 pb-3 pt-5">{header}</div>
        <div className="ui-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer ? <div className="shrink-0 border-t border-[color:var(--hmr-border)] px-5 py-3">{footer}</div> : null}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`v2-sheet-mobile absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-xl border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] ${
        dragH != null ? "is-dragging" : ""
      }`}
      style={{ height }}
    >
      <div
        className="shrink-0 touch-none px-4 pb-2.5 pt-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-[color:var(--hmr-border)]" aria-hidden />
        <div onPointerDown={(e) => e.stopPropagation()}>{header}</div>
      </div>
      <div className="ui-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </div>
  );
}
