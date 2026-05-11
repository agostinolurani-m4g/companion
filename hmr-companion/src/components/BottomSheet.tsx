"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getHmrWideRailSnapshot, subscribeHmrWideRail } from "@/lib/hmr-wide-rail";

export type SheetSnap = "peek" | "half" | "full";

export type BottomSheetProps = {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  children: React.ReactNode;
  /** Header visibile in peek; non scrolla. */
  header: React.ReactNode;
  /** In layout rail sinistro: blocco sopra i tab (es. chrome mappa unificato). */
  railTop?: React.ReactNode;
  /** Layout inferiore: rialza il foglio per lasciare spazio al profilo fisso sotto. */
  reserveProfileStrip?: boolean;
};

function snapToVh(s: SheetSnap): number {
  if (s === "peek") return 14;
  if (s === "half") return 42;
  return 88;
}

/** Larghezza pannello sinistro (viewport largo / basso). */
function snapToLeftWidth(s: SheetSnap): string {
  if (s === "peek") return "min(16vw, 10rem)";
  if (s === "half") return "min(34vw, 22rem)";
  return "min(50vw, 30rem)";
}

export default function BottomSheet({
  snap,
  onSnapChange,
  header,
  children,
  railTop,
  reserveProfileStrip = false,
}: BottomSheetProps) {
  const railLeft = useSyncExternalStore(subscribeHmrWideRail, getHmrWideRailSnapshot, () => false);
  const [dragDelta, setDragDelta] = useState(0);
  const dragStart = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (snap === "peek") el.scrollTop = 0;
  }, [snap]);

  const heightVh = snapToVh(snap);
  const leftWidth = snapToLeftWidth(snap);

  const onGrabPointerDown = (e: React.PointerEvent) => {
    dragStart.current = railLeft ? e.clientX : e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onGrabPointerMove = (e: React.PointerEvent) => {
    if (dragStart.current == null) return;
    const delta = railLeft ? e.clientX - dragStart.current : e.clientY - dragStart.current;
    setDragDelta(delta);
  };

  const onGrabPointerUp = (e: React.PointerEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    setDragDelta(0);
    if (start == null) return;

    const delta = railLeft ? e.clientX - start : e.clientY - start;
    const threshold = 60;

    if (railLeft) {
      if (delta < -threshold) {
        if (snap === "full") onSnapChange("half");
        else if (snap === "half") onSnapChange("peek");
      } else if (delta > threshold) {
        if (snap === "peek") onSnapChange("half");
        else if (snap === "half") onSnapChange("full");
      }
    } else {
      if (delta > threshold) {
        if (snap === "full") onSnapChange("half");
        else if (snap === "half") onSnapChange("peek");
      } else if (delta < -threshold) {
        if (snap === "peek") onSnapChange("half");
        else if (snap === "half") onSnapChange("full");
      }
    }
  };

  if (railLeft) {
    return (
      <div
        ref={rootRef}
        className="pointer-events-auto fixed left-0 top-0 z-20 flex h-[calc(100dvh-var(--hmr-profile-strip))] max-h-[calc(100dvh-var(--hmr-profile-strip))] flex-row border-r border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] shadow-[16px_0_48px_rgba(0,0,0,0.45)] transition-[width] duration-200 ease-out"
        style={{
          width: leftWidth,
          paddingLeft: "var(--safe-left, env(safe-area-inset-left, 0px))",
          transform: dragDelta ? `translateX(${Math.max(0, dragDelta)}px)` : undefined,
        }}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {railTop != null && (
            <div className="pointer-events-auto shrink-0 border-b border-[color:var(--hmr-border)]/80 px-2 pb-2 pt-[calc(var(--safe-top)+0.35rem)]">
              {railTop}
            </div>
          )}
          <div className="flex flex-col gap-2 border-b border-[color:var(--hmr-border)]/80 px-2 py-2">
            <div className="flex w-full items-center justify-between gap-2">{header}</div>
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {children}
          </div>
        </div>
        <div
          className="hmr-grab flex w-3 shrink-0 cursor-ew-resize touch-none flex-col items-center justify-center border-l border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-surface)] py-6 select-none"
          onPointerDown={onGrabPointerDown}
          onPointerMove={onGrabPointerMove}
          onPointerUp={onGrabPointerUp}
          onPointerCancel={onGrabPointerUp}
        >
          <span className="h-14 w-1.5 rounded-full bg-[color:var(--hmr-border)]" title="Trascina" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`pointer-events-auto fixed inset-x-0 z-20 flex flex-col rounded-none border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] shadow-[0_-20px_60px_rgba(0,0,0,0.5)] transition-[height] duration-200 ease-out ${
        reserveProfileStrip ? "bottom-[calc(var(--hmr-profile-strip)+var(--safe-bottom))]" : "bottom-0"
      }`}
      style={{
        height: `calc(${heightVh}vh + var(--safe-bottom))`,
        transform: dragDelta ? `translateY(${Math.max(0, dragDelta)}px)` : undefined,
      }}
    >
      <div
        className="hmr-grab flex flex-col items-center gap-2 px-4 pt-2 pb-1 select-none"
        onPointerDown={onGrabPointerDown}
        onPointerMove={onGrabPointerMove}
        onPointerUp={onGrabPointerUp}
        onPointerCancel={onGrabPointerUp}
      >
        <span className="h-1.5 w-12 rounded-full bg-[color:var(--hmr-border)]" />
        <div className="flex w-full items-center justify-between gap-2">{header}</div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  );
}
