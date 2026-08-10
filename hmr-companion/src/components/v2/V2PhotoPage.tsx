"use client";

import { useState } from "react";
import V2Nav from "@/components/v2/V2Nav";
import V2PhotoCapture from "@/components/v2/V2PhotoCapture";

type Props = {
  isAdmin?: boolean;
  username?: string;
};

export default function V2PhotoPage({ isAdmin = false, username }: Props) {
  const [showCapture, setShowCapture] = useState(true);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <V2Nav isAdmin={isAdmin} username={username} />
      <div className="mx-auto w-full max-w-lg flex-1 p-4">
        <h1 className="text-xl font-semibold">Carica una foto</h1>
        <p className="mt-1 text-sm text-[color:var(--hmr-muted)]">
          Geolocalizza il punto sulla mappa o usa la tua posizione attuale.
        </p>
        {!showCapture ? (
          <button
            type="button"
            onClick={() => setShowCapture(true)}
            className="mt-4 rounded-lg bg-[color:var(--hmr-accent)] px-4 py-2 text-xs font-medium text-[color:var(--hmr-bg)]"
          >
            Apri caricamento
          </button>
        ) : null}
      </div>
      {showCapture ? (
        <V2PhotoCapture
          onClose={() => setShowCapture(false)}
          onUploaded={() => setShowCapture(false)}
        />
      ) : null}
    </div>
  );
}
