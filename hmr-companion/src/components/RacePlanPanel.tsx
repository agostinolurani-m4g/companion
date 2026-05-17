"use client";

import { useCallback, useMemo, useState } from "react";
import type { RacePlanItemRow, RacePlanWithItems } from "@/lib/db";
import {
  RACE_PLAN_ITEM_KINDS,
  labelRacePlanItemKind,
  type RacePlanItemKind,
} from "@/lib/race-plan-types";
import type { StoredCoord } from "@/lib/track-coords";
import { estimateHoursBetween, loadPace } from "@/lib/pace";

type RacePlanPanelProps = {
  trackId: string;
  lengthKm: number;
  coords: StoredCoord[];
  racePlans: RacePlanWithItems[];
  onRacePlansChange: (plans: RacePlanWithItems[]) => void;
  selectedPlanId: string | null;
  onSelectPlanId: (id: string | null) => void;
  mapPickedKm: number | null;
  onClearMapPickedKm: () => void;
  mapPickActive: boolean;
  onMapPickActiveChange: (v: boolean) => void;
  pinAKm: number | null;
  pinBKm: number | null;
  /** Zoom mappa su segmento e pin A–B (tappa / voce piano). */
  onSelectSegment?: (kmStart: number, kmEnd: number) => void;
};

const emptyForm = () => ({
  kind: "note" as RacePlanItemKind,
  title: "",
  body: "",
  km_start: "0",
  km_end: "0",
  est_hours: "",
  avoid_night: false,
});

export default function RacePlanPanel({
  trackId,
  lengthKm,
  coords,
  racePlans,
  onRacePlansChange,
  selectedPlanId,
  onSelectPlanId,
  mapPickedKm,
  onClearMapPickedKm,
  mapPickActive,
  onMapPickActiveChange,
  pinAKm,
  pinBKm,
  onSelectSegment,
}: RacePlanPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>("new");
  const [form, setForm] = useState(emptyForm);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/track/${trackId}/race-plans`);
    const data = (await res.json()) as { racePlans?: RacePlanWithItems[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Errore caricamento");
    onRacePlansChange(data.racePlans ?? []);
  }, [trackId, onRacePlansChange]);

  const activePlan = useMemo(
    () => racePlans.find((p) => p.id === selectedPlanId) ?? null,
    [racePlans, selectedPlanId]
  );
  const stageItems = useMemo(
    () => (activePlan?.items ?? []).filter((it) => it.kind === "stage"),
    [activePlan]
  );

  const applyMapKm = useCallback(
    (field: "km_start" | "km_end") => {
      if (mapPickedKm == null) return;
      setForm((f) => ({
        ...f,
        [field]: mapPickedKm.toFixed(1),
      }));
      onClearMapPickedKm();
    },
    [mapPickedKm, onClearMapPickedKm]
  );

  const applyPins = useCallback(() => {
    if (pinAKm != null) {
      setForm((f) => ({
        ...f,
        km_start: pinAKm.toFixed(1),
        km_end: (pinBKm ?? pinAKm).toFixed(1),
      }));
    }
  }, [pinAKm, pinBKm]);

  const fillEstimate = useCallback(() => {
    const a = parseFloat(form.km_start);
    const b = parseFloat(form.km_end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const h = estimateHoursBetween(coords, lo, hi, loadPace());
    setForm((f) => ({ ...f, est_hours: h > 0 ? h.toFixed(2) : "" }));
  }, [coords, form.km_start, form.km_end]);

  const focusItemOnMap = (it: RacePlanItemRow) => {
    setFocusedItemId(it.id);
    onSelectSegment?.(it.km_start, it.km_end);
  };

  const startEdit = (it: RacePlanItemRow) => {
    setEditingId(it.id);
    setForm({
      kind: it.kind,
      title: it.title,
      body: it.body,
      km_start: it.km_start.toFixed(1),
      km_end: it.km_end.toFixed(1),
      est_hours: it.est_hours != null ? String(it.est_hours) : "",
      avoid_night: it.avoid_night === 1,
    });
  };

  const resetNewForm = () => {
    setEditingId("new");
    setForm(emptyForm());
  };

  const createPlan = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/track/${trackId}/race-plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Piano ${racePlans.length + 1}` }),
      });
      const data = (await res.json()) as { plan?: RacePlanWithItems; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Errore");
      await reload();
      if (data.plan) onSelectPlanId(data.plan.id);
      resetNewForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const renamePlan = async () => {
    if (!selectedPlanId) return;
    const name = window.prompt("Nome piano", activePlan?.name ?? "");
    if (name == null || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/track/${trackId}/race-plans/${selectedPlanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Errore");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deletePlan = async () => {
    if (!selectedPlanId) return;
    if (!window.confirm("Eliminare questo piano e tutte le voci?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/track/${trackId}/race-plans/${selectedPlanId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Errore");
      await reload();
      onSelectPlanId(null);
      resetNewForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveItem = async () => {
    if (!selectedPlanId) return;
    const km_start = parseFloat(form.km_start);
    const km_end = parseFloat(form.km_end);
    if (!Number.isFinite(km_start) || !Number.isFinite(km_end)) {
      setError("Km non validi");
      return;
    }
    let est_hours: number | null = null;
    if (form.est_hours.trim() !== "") {
      const h = parseFloat(form.est_hours);
      if (Number.isFinite(h) && h >= 0) est_hours = h;
    }
    const body = {
      kind: form.kind,
      title: form.title.trim(),
      body: form.body.trim(),
      km_start,
      km_end,
      est_hours,
      avoid_night: form.avoid_night,
    };
    setBusy(true);
    setError(null);
    try {
      if (editingId && editingId !== "new") {
        const res = await fetch(
          `/api/track/${trackId}/race-plans/${selectedPlanId}/items/${editingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Errore");
      } else {
        const res = await fetch(`/api/track/${trackId}/race-plans/${selectedPlanId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Errore");
      }
      await reload();
      resetNewForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (itemId: string) => {
    if (!selectedPlanId) return;
    if (!window.confirm("Eliminare questa voce?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/track/${trackId}/race-plans/${selectedPlanId}/items/${itemId}`,
        { method: "DELETE" }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Errore");
      await reload();
      if (editingId === itemId) resetNewForm();
      setFocusedItemId((cur) => (cur === itemId ? null : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-3 pb-4 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[10px] uppercase tracking-wide text-[color:var(--hmr-muted)]">
          Piano
        </label>
        <select
          className="hmr-panel min-h-[44px] flex-1 min-w-[8rem] rounded-xl border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-2 text-sm"
          value={selectedPlanId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onSelectPlanId(v ? v : null);
            resetNewForm();
            setFocusedItemId(null);
          }}
        >
          <option value="">—</option>
          {racePlans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="hmr-btn hmr-tap text-xs" disabled={busy} onClick={createPlan}>
          Nuovo
        </button>
        <button
          type="button"
          className="hmr-btn hmr-tap text-xs"
          disabled={!selectedPlanId || busy}
          onClick={renamePlan}
        >
          Rinomina
        </button>
        <button
          type="button"
          className="hmr-btn hmr-tap text-xs"
          disabled={!selectedPlanId || busy}
          onClick={deletePlan}
          style={{ color: "var(--hmr-danger)", borderColor: "rgba(248,113,113,0.4)" }}
        >
          Elimina piano
        </button>
      </div>

      {!selectedPlanId && (
        <p className="text-xs text-[color:var(--hmr-muted)]">
          Crea un piano gara per annotare pernottamenti, tappe, stime su segmenti e tratti da evitare di notte.
          Ogni traccia può avere più piani (versioni / ipotesi).
        </p>
      )}

      {selectedPlanId && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--hmr-border)] bg-black/15 px-2 py-2">
            <button
              type="button"
              className={`hmr-chip hmr-tap text-xs ${mapPickActive ? "hmr-chip-on" : "hmr-chip-off"}`}
              onClick={() => onMapPickActiveChange(!mapPickActive)}
            >
              {mapPickActive ? "Tap mappa: ON" : "Tap mappa: OFF"}
            </button>
            {mapPickedKm != null && (
              <span className="text-xs text-[color:var(--hmr-accent)]">
                Ultimo tap: km {mapPickedKm.toFixed(1)}
              </span>
            )}
            {mapPickedKm != null && (
              <>
                <button type="button" className="hmr-btn hmr-tap text-[10px]" onClick={() => applyMapKm("km_start")}>
                  → inizio
                </button>
                <button type="button" className="hmr-btn hmr-tap text-[10px]" onClick={() => applyMapKm("km_end")}>
                  → fine
                </button>
              </>
            )}
          </div>

          <div className="hmr-panel space-y-2 p-3">
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--hmr-muted)]">
              {editingId && editingId !== "new" ? "Modifica voce" : "Nuova voce"}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-[color:var(--hmr-muted)]">
                Tipo
                <select
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-2 text-sm"
                  value={form.kind}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, kind: e.target.value as RacePlanItemKind }))
                  }
                >
                  {RACE_PLAN_ITEM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {labelRacePlanItemKind(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[color:var(--hmr-muted)]">
                Titolo
                <input
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 text-sm"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="es. Dormire a Metsovo"
                />
              </label>
            </div>
            <label className="block text-xs text-[color:var(--hmr-muted)]">
              Note
              <textarea
                className="mt-1 min-h-[4rem] w-full rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-2 text-sm"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-xs text-[color:var(--hmr-muted)]">
                Km inizio
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={lengthKm}
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 text-sm"
                  value={form.km_start}
                  onChange={(e) => setForm((f) => ({ ...f, km_start: e.target.value }))}
                />
              </label>
              <label className="text-xs text-[color:var(--hmr-muted)]">
                Km fine
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={lengthKm}
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 text-sm"
                  value={form.km_end}
                  onChange={(e) => setForm((f) => ({ ...f, km_end: e.target.value }))}
                />
              </label>
              <label className="text-xs text-[color:var(--hmr-muted)]">
                Ore (stima)
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 text-sm"
                  value={form.est_hours}
                  onChange={(e) => setForm((f) => ({ ...f, est_hours: e.target.value }))}
                  placeholder="opz."
                />
              </label>
              <label className="flex flex-col justify-end text-xs text-[color:var(--hmr-muted)]">
                <span className="mb-1">Evita di notte</span>
                <input
                  type="checkbox"
                  className="h-6 w-6 accent-[color:var(--hmr-accent)]"
                  checked={form.avoid_night}
                  onChange={(e) => setForm((f) => ({ ...f, avoid_night: e.target.checked }))}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="hmr-btn hmr-tap text-xs" disabled={busy} onClick={applyPins}>
                Applica pin A/B
              </button>
              <button type="button" className="hmr-btn hmr-tap text-xs" disabled={busy} onClick={fillEstimate}>
                Stima ore (pace)
              </button>
              <button
                type="button"
                className="hmr-btn hmr-btn-accent hmr-tap ml-auto text-xs"
                disabled={busy}
                onClick={saveItem}
              >
                {editingId && editingId !== "new" ? "Salva" : "Aggiungi"}
              </button>
              {editingId && editingId !== "new" && (
                <button type="button" className="hmr-btn hmr-tap text-xs" disabled={busy} onClick={resetNewForm}>
                  Nuova voce
                </button>
              )}
            </div>
          </div>

          <div>
            {stageItems.length > 0 && (
              <div className="mb-3">
                <h3 className="mb-2 text-[10px] uppercase tracking-wide text-[color:var(--hmr-muted)]">
                  Tappe piano ({stageItems.length})
                </h3>
                <ul className="space-y-1.5">
                  {stageItems.map((it, idx) => (
                    <li key={`stage-${it.id}`}>
                      <button
                        type="button"
                        onClick={() => focusItemOnMap(it)}
                        className={`hmr-panel flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-xs touch-manipulation ${
                          focusedItemId === it.id ? "ring-1 ring-[color:var(--hmr-accent)]" : ""
                        }`}
                      >
                        <span className="truncate">
                          Tappa {idx + 1}: {it.title || "Senza titolo"}
                        </span>
                        <span className="shrink-0 text-[color:var(--hmr-muted)]">
                          {it.km_start.toFixed(1)}→{it.km_end.toFixed(1)}
                        </span>
                      </button>
                      {focusedItemId === it.id && (it.body || it.est_hours != null) && (
                        <div className="mt-1 border border-[color:var(--hmr-border)]/60 bg-black/20 px-2 py-2 text-[11px] leading-snug text-[color:var(--hmr-muted)]">
                          {it.est_hours != null && <p>Stima: ~{it.est_hours} h</p>}
                          {it.body ? <p className="mt-1 whitespace-pre-wrap text-[color:var(--hmr-text)]">{it.body}</p> : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h3 className="mb-2 text-[10px] uppercase tracking-wide text-[color:var(--hmr-muted)]">
              Voci ({activePlan?.items.length ?? 0})
            </h3>
            <ul className="space-y-2">
              {(activePlan?.items ?? []).map((it) => (
                <li key={it.id} className="space-y-1">
                  <div
                    className={`hmr-panel flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between ${
                      focusedItemId === it.id ? "ring-1 ring-[color:var(--hmr-accent)]" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer touch-manipulation text-left"
                      onClick={() => focusItemOnMap(it)}
                    >
                      <div className="font-medium">
                        <span className="text-[color:var(--hmr-muted)]">{labelRacePlanItemKind(it.kind)}</span>{" "}
                        {it.title || "(senza titolo)"}
                      </div>
                      <div className="text-xs text-[color:var(--hmr-muted)]">
                        km {it.km_start.toFixed(1)}
                        {Math.abs(it.km_end - it.km_start) >= 0.05 ? ` → ${it.km_end.toFixed(1)}` : ""}
                        {it.est_hours != null ? ` · ~${it.est_hours} h` : ""}
                        {it.avoid_night === 1 ? " · notte" : ""}
                      </div>
                      {focusedItemId !== it.id && it.body ? (
                        <p className="mt-1 line-clamp-2 text-xs text-[color:var(--hmr-faint)]">{it.body}</p>
                      ) : null}
                    </button>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" className="hmr-btn hmr-tap text-xs" onClick={() => startEdit(it)}>
                        Modifica
                      </button>
                      <button
                        type="button"
                        className="hmr-btn hmr-tap text-xs"
                        style={{ color: "var(--hmr-danger)" }}
                        onClick={() => deleteItem(it.id)}
                      >
                        Elimina
                      </button>
                    </div>
                  </div>
                  {focusedItemId === it.id && (
                    <div className="border border-[color:var(--hmr-border)]/60 bg-black/20 px-3 py-2 text-xs leading-snug text-[color:var(--hmr-text)]">
                      <p className="text-[10px] uppercase tracking-wide text-[color:var(--hmr-muted)]">Dettaglio · mappa</p>
                      {it.body ? <p className="mt-1 whitespace-pre-wrap">{it.body}</p> : <p className="text-[color:var(--hmr-faint)]">Nessuna nota.</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {error && <p className="text-xs text-[color:var(--hmr-danger)]">{error}</p>}
    </div>
  );
}
