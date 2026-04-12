"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { ExplorePlaceRow } from "@/lib/types";

export function ExploreTab() {
  const [places, setPlaces] = useState<ExplorePlaceRow[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/explore");
      const j = (await res.json()) as { places: ExplorePlaceRow[] };
      setPlaces(j.places ?? []);
    })();
  }, []);

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-3">
      <p className="text-xs text-zinc-500">
        Luoghi demo (seed locale). In futuro: community e contenuti reali.
      </p>
      <ul className="space-y-3">
        {places.map((pl) => (
          <li
            key={pl.id}
            className="flex gap-3 rounded-lg border border-zinc-700/40 bg-zinc-950/50 p-2"
          >
            <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded bg-zinc-800">
              {pl.image_url ? (
                <Image
                  src={pl.image_url}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="112px"
                  unoptimized
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-zinc-100">{pl.name}</div>
              <p className="text-xs text-zinc-400 line-clamp-2">{pl.description}</p>
              <p className="mt-1 text-[10px] text-zinc-500">
                ★ {pl.rating.toFixed(1)} · {pl.review_count} recensioni
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
