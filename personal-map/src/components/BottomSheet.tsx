"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

export type SheetSnap = "peek" | "half" | "full";

export type BottomSheetProps = {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  children: ReactNode;
  header: ReactNode;
  /** Alza il foglio sopra la fascia profilo altimetrico fissa in basso. */
  reserveProfileStrip?: boolean;
};

function mobileSheetMaxHeight(reserveProfileStrip: boolean): string {
  if (reserveProfileStrip) {
    return "calc(100dvh - var(--safe-top) - var(--hmr-profile-strip) - var(--safe-bottom) - 0.35rem)";
  }
  return "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 0.35rem)";
}

function sheetHeightStyle(snap: SheetSnap, reserveProfileStrip: boolean): CSSProperties {
  const maxH = mobileSheetMaxHeight(reserveProfileStrip);
  if (snap === "peek") {
    return {
      height: "max(6.25rem, calc(10vh + var(--safe-bottom)))",
      maxHeight: maxH,
    };
  }
  if (snap === "half") {
    return {
      height: `min(calc(36vh + var(--safe-bottom)), ${maxH})`,
      maxHeight: maxH,
    };
  }
  return { height: maxH, maxHeight: maxH };
}

export default function BottomSheet({
  snap,
  onSnapChange,
  children,
  header,
  reserveProfileStrip = true,
}: BottomSheetProps) {
  const [dragDelta, setDragDelta] = useState(0);
  const dragStart = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (snap === "peek") el.scrollTop = 0;
  }, [snap]);

  const collapseSheet = () => {
    if (snap === "full") onSnapChange("half");
    else onSnapChange("peek");
  };

  const expandSheet = () => {
    if (snap === "peek") onSnapChange("half");
    else if (snap === "half") onSnapChange("full");
  };

  const onGrabPointerDown = (e: React.PointerEvent) => {
    dragStart.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onGrabPointerMove = (e: React.PointerEvent) => {
    if (dragStart.current == null) return;
    setDragDelta(e.clientY - dragStart.current);
  };

  const onGrabPointerUp = (e: React.PointerEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    setDragDelta(0);
    if (start == null) return;

    const delta = e.clientY - start;
    const threshold = 60;
    if (delta > threshold) {
      if (snap === "full") onSnapChange("half");
      else if (snap === "half") onSnapChange("peek");
    } else if (delta < -threshold) {
      if (snap === "peek") onSnapChange("half");
      else if (snap === "half") onSnapChange("full");
    }
  };

  return (
    <div
      className={`pointer-events-auto fixed inset-x-0 flex min-h-0 flex-col overflow-hidden rounded-t-xl border-t border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)] shadow-[0_-20px_60px_rgba(0,0,0,0.5)] transition-[height,z-index] duration-200 ease-out ${
        snap === "full" ? "z-[35]" : "z-20"
      } ${
        reserveProfileStrip
          ? "bottom-[calc(var(--hmr-profile-strip)+var(--safe-bottom))]"
          : "bottom-0"
      }`}
      style={{
        ...sheetHeightStyle(snap, reserveProfileStrip),
        transform: dragDelta ? `translateY(${Math.max(0, dragDelta)}px)` : undefined,
      }}
    >
      <div className="flex min-h-0 shrink-0 flex-col border-b border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-surface)]">
        <div
          className="hmr-grab flex touch-none flex-col items-center gap-1 px-3 pt-1.5 pb-0.5 select-none"
          onPointerDown={onGrabPointerDown}
          onPointerMove={onGrabPointerMove}
          onPointerUp={onGrabPointerUp}
          onPointerCancel={onGrabPointerUp}
        >
          <span className="h-1.5 w-12 rounded-full bg-[color:var(--hmr-border)]" />
        </div>
        <div className="flex min-h-0 items-start gap-1 px-2 pb-1.5">
          <div className="min-h-0 min-w-0 flex-1">{header}</div>
          <div className="flex shrink-0 flex-col gap-0.5">
            {snap !== "full" && (
              <button
                type="button"
                title="Espandi pannello"
                aria-label="Espandi pannello"
                onClick={expandSheet}
                className="hmr-btn hmr-tap !min-h-[2rem] !min-w-[2rem] touch-manipulation px-2 py-1 text-sm leading-none"
              >
                ↑
              </button>
            )}
            {snap !== "peek" && (
              <button
                type="button"
                title="Riduci pannello"
                aria-label="Riduci pannello"
                onClick={collapseSheet}
                className="hmr-btn hmr-tap !min-h-[2rem] !min-w-[2rem] touch-manipulation px-2 py-1 text-sm leading-none"
              >
                ↓
              </button>
            )}
          </div>
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  );
}
