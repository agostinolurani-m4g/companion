"use client";

import { useEffect, useRef, useState } from "react";

export type SheetSnap = "peek" | "half" | "full";

export type BottomSheetProps = {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  children: React.ReactNode;
  /** Header visibile in peek; non scrolla. */
  header: React.ReactNode;
};

function snapToVh(s: SheetSnap): number {
  if (s === "peek") return 14;
  if (s === "half") return 42;
  return 88;
}

export default function BottomSheet({ snap, onSnapChange, header, children }: BottomSheetProps) {
  const [dragDelta, setDragDelta] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (snap === "peek") el.scrollTop = 0;
  }, [snap]);

  const heightVh = snapToVh(snap);

  return (
    <div
      ref={rootRef}
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] shadow-[0_-20px_60px_rgba(0,0,0,0.5)] transition-[height] duration-200 ease-out"
      style={{
        height: `calc(${heightVh}vh + var(--safe-bottom))`,
        transform: dragDelta ? `translateY(${Math.max(0, dragDelta)}px)` : undefined,
      }}
    >
      <div
        className="hmr-grab flex flex-col items-center gap-2 px-4 pt-2 pb-1 select-none"
        onPointerDown={(e) => {
          dragStartY.current = e.clientY;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragStartY.current == null) return;
          const dy = e.clientY - dragStartY.current;
          setDragDelta(dy);
        }}
        onPointerUp={(e) => {
          const dy = dragStartY.current != null ? e.clientY - dragStartY.current : 0;
          dragStartY.current = null;
          setDragDelta(0);
          const threshold = 60;
          if (dy > threshold) {
            if (snap === "full") onSnapChange("half");
            else if (snap === "half") onSnapChange("peek");
          } else if (dy < -threshold) {
            if (snap === "peek") onSnapChange("half");
            else if (snap === "half") onSnapChange("full");
          }
        }}
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
