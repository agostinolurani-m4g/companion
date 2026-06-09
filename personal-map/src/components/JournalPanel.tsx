"use client";

import { useCallback, useRef, useState } from "react";
import type { TrackJournalEntryRow } from "@/lib/db";
import type { HazardKind } from "@/lib/db";
import { computeJournalCompleteness } from "@/lib/journal-completeness";
import { SPORT_MODES, type SportMode } from "@/lib/sport-modes";

const HAZARD_CHIPS: { kind: HazardKind; label: string }[] = [
  { kind: "landslide", label: "Frana" },
  { kind: "avalanche", label: "Valanga" },
  { kind: "technical_trail", label: "Tecnico" },
  { kind: "snow_condition", label: "Neve" },
  { kind: "other", label: "Altro" },
];

type Props = {
  trackId: string;
  lengthKm: number;
  journalSummary: string | null;
  sportMode: SportMode | null;
  entries: TrackJournalEntryRow[];
  atKm: number | null;
  myPosition: { lat: number; lng: number } | null;
  grade: string | null;
  onSummaryChange: (s: string) => void;
  onSportModeChange: (m: SportMode) => void;
  onEntriesChange: (entries: TrackJournalEntryRow[]) => void;
  onSelectKm: (km: number) => void;
  onAnalyzeDifficulty: () => void;
  analyzing: boolean;
};

function kindIcon(kind: TrackJournalEntryRow["kind"]): string {
  if (kind === "photo") return "📸";
  if (kind === "condition") return "⚠";
  if (kind === "milestone") return "🏁";
  return "📝";
}

export default function JournalPanel({
  trackId,
  lengthKm,
  journalSummary,
  sportMode,
  entries,
  atKm,
  myPosition,
  grade,
  onSummaryChange,
  onSportModeChange,
  onEntriesChange,
  onSelectKm,
  onAnalyzeDifficulty,
  analyzing,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summaryDraft, setSummaryDraft] = useState(journalSummary ?? "");
  const [noteDraft, setNoteDraft] = useState("");

  const completeness = computeJournalCompleteness(lengthKm, journalSummary, entries);

  const saveSummary = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(trackId)}/summary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ journal_summary: summaryDraft }),
      });
      if (!res.ok) throw new Error("Salvataggio relazione fallito");
      onSummaryChange(summaryDraft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [trackId, summaryDraft, onSummaryChange]);

  const addNote = useCallback(async () => {
    const km = atKm ?? 0;
    if (!noteDraft.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(trackId)}/journal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ along_km: km, kind: "note", body: noteDraft.trim() }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Errore");
      const refreshed = await fetch(`/api/track/${encodeURIComponent(trackId)}/journal`, {
        credentials: "same-origin",
      });
      const j = (await refreshed.json()) as { entries: TrackJournalEntryRow[] };
      onEntriesChange(j.entries);
      setNoteDraft("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [trackId, atKm, noteDraft, onEntriesChange]);

  const uploadPhoto = useCallback(
    async (file: File) => {
      const km = atKm ?? 0;
      setBusy(true);
      setErr(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("along_km", String(km));
        const res = await fetch(`/api/track/${encodeURIComponent(trackId)}/journal/upload`, {
          method: "POST",
          credentials: "same-origin",
          body: fd,
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? "Upload fallito");
        }
        const refreshed = await fetch(`/api/track/${encodeURIComponent(trackId)}/journal`, {
          credentials: "same-origin",
        });
        const j = (await refreshed.json()) as { entries: TrackJournalEntryRow[] };
        onEntriesChange(j.entries);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [trackId, atKm, onEntriesChange]
  );

  const reportHazard = useCallback(
    async (kind: HazardKind) => {
      if (!myPosition) {
        setErr("Attiva GPS per segnalare");
        return;
      }
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch("/api/hazards/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            lat: myPosition.lat,
            lng: myPosition.lng,
            kind,
            trackId,
          }),
        });
        const data = (await res.json()) as { confirmed?: boolean; report_count?: number; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Segnalazione fallita");
        if (data.confirmed) {
          onAnalyzeDifficulty();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [myPosition, trackId, onAnalyzeDifficulty]
  );

  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sportMode ?? "trekking"}
          onChange={async (e) => {
            const m = e.target.value as SportMode;
            await fetch(`/api/track/${encodeURIComponent(trackId)}/summary`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ sport_mode: m }),
            });
            onSportModeChange(m);
            onAnalyzeDifficulty();
          }}
          className="hmr-input text-xs"
        >
          {SPORT_MODES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {grade ? (
          <span className="hmr-chip hmr-chip-on text-[10px]">Grado {grade}</span>
        ) : null}
        <span className="text-[10px] text-[color:var(--hmr-muted)]">
          Completezza {completeness}%
        </span>
        <div className="h-1.5 flex-1 min-w-[80px] rounded-full bg-[color:var(--hmr-border)]">
          <div
            className="h-full rounded-full bg-[color:var(--hmr-accent)]"
            style={{ width: `${completeness}%` }}
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-medium text-[color:var(--hmr-muted)]">Relazione</label>
        <textarea
          value={summaryDraft}
          onChange={(e) => setSummaryDraft(e.target.value)}
          rows={3}
          className="hmr-input mt-1 w-full text-xs"
          placeholder="Come una gita su Gulliver: condizioni, varianti, consigli…"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveSummary()}
          className="hmr-btn hmr-tap mt-1 text-[10px]"
        >
          Salva relazione
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="hmr-chip hmr-chip-on hmr-tap text-[10px]"
        >
          + Foto {atKm != null ? `@ km ${atKm.toFixed(1)}` : ""}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadPhoto(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy || !noteDraft.trim()}
          onClick={() => void addNote()}
          className="hmr-chip hmr-chip-off hmr-tap text-[10px]"
        >
          + Nota
        </button>
        <button
          type="button"
          disabled={analyzing}
          onClick={onAnalyzeDifficulty}
          className="hmr-chip hmr-chip-off hmr-tap text-[10px]"
        >
          {analyzing ? "Analisi…" : "Analizza difficoltà"}
        </button>
      </div>

      <input
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        placeholder={atKm != null ? `Nota al km ${atKm.toFixed(1)}…` : "Nota al km corrente…"}
        className="hmr-input w-full text-xs"
      />

      <div>
        <p className="mb-1 text-[10px] font-medium text-[color:var(--hmr-muted)]">Segnala (GPS)</p>
        <div className="flex flex-wrap gap-1">
          {HAZARD_CHIPS.map((h) => (
            <button
              key={h.kind}
              type="button"
              disabled={busy || !myPosition}
              onClick={() => void reportHazard(h.kind)}
              className="hmr-chip hmr-chip-off hmr-tap text-[10px]"
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onSelectKm(e.along_km)}
              className="hmr-panel w-full rounded-lg p-2 text-left text-xs"
            >
              <span className="text-[color:var(--hmr-muted)]">
                km {e.along_km.toFixed(1)} {kindIcon(e.kind)}
              </span>
              {e.title ? <p className="font-medium">{e.title}</p> : null}
              {e.body ? <p className="mt-0.5 text-[color:var(--hmr-muted)]">{e.body}</p> : null}
              {e.photo_path ? (
                <img
                  src={`/api/journal-photo?path=${encodeURIComponent(e.photo_path)}`}
                  alt=""
                  className="mt-2 max-h-32 rounded object-cover"
                />
              ) : null}
            </button>
          </li>
        ))}
        {entries.length === 0 ? (
          <p className="text-xs text-[color:var(--hmr-muted)]">
            Nessuna voce nel diario. Aggiungi foto e note lungo il percorso.
          </p>
        ) : null}
      </ul>

      {err ? <p className="text-xs text-red-400">{err}</p> : null}
    </div>
  );
}
