"use client";

import { useState } from "react";
import type { OutingVisibility } from "@/lib/types";
import { DEMO_GROUP_CAI } from "@/lib/social-constants";

type Props = {
  itineraryId: string | null;
  hasActiveUser: boolean;
  hasLineOnMap: boolean;
  onPublished?: () => void;
};

const VIS: { value: OutingVisibility; label: string }[] = [
  { value: "friends", label: "Amici" },
  { value: "group", label: "Gruppo (scegli CAI in hub)" },
  { value: "public", label: "Pubblico" },
  { value: "private", label: "Privato" },
  { value: "followers", label: "Chi mi segue" },
];

export function PublishOutingBar({
  itineraryId,
  hasActiveUser,
  hasLineOnMap,
  onPublished,
}: Props) {
  const [visibility, setVisibility] = useState<OutingVisibility>("friends");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!itineraryId) return null;

  const publish = async () => {
    setMsg(null);
    if (!hasActiveUser) {
      setMsg("Imposta l’utente attivo nel profilo.");
      return;
    }
    if (!hasLineOnMap) {
      setMsg("Salva una traccia sulla mappa (OSRM o GPX) prima di pubblicare.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/itineraries/${itineraryId}/outing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visibility,
          notes: notes.trim() || null,
          started_at: new Date().toISOString(),
          group_id: visibility === "group" ? DEMO_GROUP_CAI : null,
        }),
      });
      const j = (await res.json()) as { error?: string; outing?: { id: string } };
      if (!res.ok) {
        setMsg(j.error ?? "Errore");
        return;
      }
      setMsg("Uscita pubblicata nel feed locale.");
      setNotes("");
      onPublished?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded border border-emerald-900/40 bg-emerald-950/20 px-2 py-1.5 text-[10px] text-zinc-400">
      <div className="font-medium text-emerald-200/90">Pubblica come uscita</div>
      <p className="mt-0.5 leading-snug text-zinc-500">
        Crea un percorso nella tabella <code className="text-zinc-400">routes</code> e un’uscita collegata a questo itinerario (POC SQLite).
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span className="text-zinc-500">Visibilità</span>
          <select
            className="max-w-[140px] rounded border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-200"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as OutingVisibility)}
          >
            {VIS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-600"
        rows={2}
        placeholder="Note sull’uscita (opzionale)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <button
        type="button"
        disabled={loading}
        className="mt-1 rounded bg-emerald-800 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        onClick={() => void publish()}
      >
        {loading ? "Pubblicazione…" : "Pubblica nel feed"}
      </button>
      {msg ? <p className="mt-1 text-[10px] text-zinc-400">{msg}</p> : null}
    </div>
  );
}
