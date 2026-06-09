"use client";

import { type CSSProperties, type ReactNode, useState } from "react";

export type SheetSnap = "peek" | "half" | "full";

export type BottomSheetProps = {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  children: ReactNode;
  header: ReactNode;
  reserveProfileStrip?: boolean;
};

function sheetHeightStyle(snap: SheetSnap, reserveProfileStrip: boolean): CSSProperties {
  const maxH = reserveProfileStrip
    ? "calc(100dvh - var(--safe-top) - var(--hmr-profile-strip) - var(--safe-bottom) - 0.35rem)"
    : "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 0.35rem)";
  if (snap === "peek") {
    return { height: "max(6.25rem, calc(10vh + var(--safe-bottom)))", maxHeight: maxH };
  }
  if (snap === "half") {
    return { height: `min(calc(36vh + var(--safe-bottom)), ${maxH})`, maxHeight: maxH };
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
  const [dragY, setDragY] = useState(0);

  const cycleSnap = () => {
    if (snap === "peek") onSnapChange("half");
    else if (snap === "half") onSnapChange("full");
    else onSnapChange("peek");
  };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <div
        className="pointer-events-auto flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-[color:var(--hmr-border)] bg-[color:var(--hmr-surface)]/98 shadow-2xl backdrop-blur-md"
        style={{
          ...sheetHeightStyle(snap, reserveProfileStrip),
          transform: dragY ? `translateY(${dragY}px)` : undefined,
        }}
      >
        <button
          type="button"
          className="hmr-grab flex w-full shrink-0 flex-col items-center py-2"
          onClick={cycleSnap}
          aria-label="Espandi o riduci pannello"
        >
          <span className="h-1 w-10 rounded-full bg-[color:var(--hmr-border)]" />
        </button>
        <div className="shrink-0 border-b border-[color:var(--hmr-border)]/60">{header}</div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
