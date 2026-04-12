"use client";

import { usePlanner } from "@/context/PlannerProvider";

export function ConfirmEmailModal() {
  const { draftEmail, setDraftEmail } = usePlanner();
  if (!draftEmail) return null;

  const openMailto = () => {
    const href = `mailto:${encodeURIComponent(draftEmail.to)}?subject=${encodeURIComponent(
      draftEmail.subject
    )}&body=${encodeURIComponent(draftEmail.body)}`;
    window.location.href = href;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-zinc-600 bg-zinc-900 p-4 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-100">Conferma bozza email</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Nessun invio automatico: puoi aprire il client di posta con questa bozza.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="text-zinc-500">A</dt>
            <dd className="text-zinc-100">{draftEmail.to}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Oggetto</dt>
            <dd className="text-zinc-100">{draftEmail.subject}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Testo</dt>
            <dd className="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-zinc-200">
              {draftEmail.body}
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
            onClick={() => setDraftEmail(null)}
          >
            Chiudi
          </button>
          <button
            type="button"
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white"
            onClick={() => {
              openMailto();
              setDraftEmail(null);
            }}
          >
            Apri in client email
          </button>
        </div>
      </div>
    </div>
  );
}
