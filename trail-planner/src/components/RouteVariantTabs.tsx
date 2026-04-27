"use client";

import type { RouteVariantRow } from "@/lib/types";

type Props = {
  variants: RouteVariantRow[];
  activeVariantId: string | null;
  onSelect: (variantId: string) => void;
};

export function RouteVariantTabs({ variants, activeVariantId, onSelect }: Props) {
  if (variants.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">Percorsi</span>
      {variants.map((v) => {
        const active = activeVariantId === v.id;
        return (
          <button
            key={v.id}
            type="button"
            title={v.label}
            className={`max-w-[140px] truncate rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              active
                ? "bg-emerald-800 text-white"
                : "bg-zinc-800/90 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
            onClick={() => onSelect(v.id)}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
