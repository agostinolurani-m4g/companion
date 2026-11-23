"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/v2/ui/Icon";
import type { MapPhoto } from "@/lib/photo-geo";

type Props = {
  photos: MapPhoto[];
  startIndex?: number;
  onClose: () => void;
};

/** Galleria a schermo intero (frecce, swipe, Esc) per le foto aperte dalla mappa. */
export default function V2PhotoLightbox({ photos, startIndex = 0, onClose }: Props) {
  const [i, setI] = useState(Math.min(Math.max(startIndex, 0), Math.max(photos.length - 1, 0)));
  const [touchX, setTouchX] = useState<number | null>(null);
  const go = useCallback((d: number) => setI((v) => (photos.length ? (v + d + photos.length) % photos.length : 0)), [photos.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  const p = photos[i];
  if (!p) return null;
  const date = p.created_at ? new Date(p.created_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Foto"
      className="fixed inset-0 z-[80] flex flex-col bg-black/90 text-white"
      onClick={onClose}
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX == null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        setTouchX(null);
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
        <span className="opacity-80">
          {i + 1} / {photos.length}
        </span>
        <button type="button" onClick={onClose} aria-label="Chiudi" className="rounded-full p-2 hover:bg-white/10">
          <Icon name="close" size={22} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        {p.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.url}
            alt={p.caption || "Foto"}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
        {photos.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Foto precedente"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl sm:block"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Foto successiva"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl sm:block"
            >
              ›
            </button>
          </>
        ) : null}
      </div>
      <div className="px-4 pb-6 pt-3 text-sm" onClick={(e) => e.stopPropagation()}>
        {p.caption ? <p className="font-medium">{p.caption}</p> : null}
        <p className="mt-0.5 text-xs opacity-70">
          {[p.owner ? `@${p.owner}` : null, date].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}
