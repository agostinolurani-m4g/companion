"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  detail?: string;
};

/** Modale generica per “prenotazione” o azione sensibile (solo conferma testuale, nessuna API). */
export function BookingConfirmModal({ open, onClose, title, detail }: Props) {
  const [checked, setChecked] = useState(false);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-600 bg-zinc-900 p-4 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-100">{title ?? "Conferma azione"}</h2>
        {detail && <p className="mt-2 text-sm text-zinc-300 whitespace-pre-wrap">{detail}</p>}
        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          Ho verificato i dettagli e voglio procedere sul sito esterno.
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
            onClick={() => {
              setChecked(false);
              onClose();
            }}
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={!checked}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            onClick={() => {
              setChecked(false);
              onClose();
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
