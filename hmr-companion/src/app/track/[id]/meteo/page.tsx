"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import WindyMeteoMap from "@/components/WindyMeteoMap";

function parseNum(s: string | null, fallback: number): number {
  if (s == null || s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function TrackMeteoInner() {
  const params = useParams();
  const sp = useSearchParams();
  const id = typeof params.id === "string" ? params.id : "";

  const lat = parseNum(sp.get("lat"), 45.5);
  const lng = parseNum(sp.get("lng"), 9.2);
  const zoom = parseNum(sp.get("zoom"), 8);
  const mode = sp.get("mode") === "rain" ? "rain" : "radar";

  if (!id) {
    return (
      <div className="flex h-[100dvh] items-center justify-center text-sm text-[color:var(--hmr-muted)]">
        ID traccia mancante.
      </div>
    );
  }

  return <WindyMeteoMap trackId={id} lat={lat} lng={lng} zoom={zoom} mode={mode} />;
}

export default function TrackMeteoPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center text-sm text-[color:var(--hmr-muted)]">
          Caricamento meteo…
        </div>
      }
    >
      <TrackMeteoInner />
    </Suspense>
  );
}
