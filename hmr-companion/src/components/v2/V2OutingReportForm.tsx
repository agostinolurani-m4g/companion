"use client";

import { useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import {
  CONDITION_FIELD_LABELS,
  SNOW_QUALITIES,
  SNOW_QUALITY_LABELS,
  TRAIL_STATE_LABELS,
  TRAIL_STATES,
  WEATHER_SKIES,
  WEATHER_SKY_LABELS,
  WIND_LABELS,
  WINDS,
  type OutingConditions,
  type OutingDto,
} from "@/lib/outings-types";
import { outingConditionFields, type UserRouteActivity } from "@/lib/sports";

type Props = {
  outing: Pick<OutingDto, "id" | "story" | "conditions" | "status">;
  activity: UserRouteActivity;
  onSaved: (o: OutingDto) => void;
  onCancel?: () => void;
};

function Chips<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T | undefined;
  onChange: (v: T | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          className="ui-chip !min-h-[28px] !text-[12px]"
          onClick={() => onChange(value === o ? undefined : o)}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function NoteInput({ value, onChange, placeholder }: { value?: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="ui-input mt-1.5 w-full !min-h-[34px] !text-[12.5px]"
    />
  );
}

/** Resoconto della gita: condizioni (per sport), racconto, valutazione. Salva e segna come fatta. */
export default function V2OutingReportForm({ outing, activity, onSaved, onCancel }: Props) {
  const fields = outingConditionFields(activity);
  const [c, setC] = useState<OutingConditions>(outing.conditions ?? {});
  const [story, setStory] = useState(outing.story);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof OutingConditions>(k: K, v: OutingConditions[K]) => setC((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await fetchJson<{ outing: OutingDto }>(`/api/v2/outings/${encodeURIComponent(outing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done", story, conditions: c }),
      });
      onSaved(data.outing);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {fields.includes("snow") ? (
        <section>
          <h3 className="ui-eyebrow mb-1.5">{CONDITION_FIELD_LABELS.snow}</h3>
          <Chips
            options={SNOW_QUALITIES}
            labels={SNOW_QUALITY_LABELS}
            value={c.snow?.quality}
            onChange={(quality) => set("snow", { ...c.snow, quality })}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <label className="text-[12px] text-[color:var(--hmr-muted)]" htmlFor="snow-ele">
              Neve da
            </label>
            <input
              id="snow-ele"
              type="number"
              inputMode="numeric"
              min={0}
              max={5000}
              step={50}
              value={c.snow?.from_ele_m ?? ""}
              onChange={(e) =>
                set("snow", { ...c.snow, from_ele_m: e.target.value === "" ? undefined : Number(e.target.value) })
              }
              className="ui-input w-24 !min-h-[34px] !text-[12.5px]"
            />
            <span className="text-[12px] text-[color:var(--hmr-muted)]">m</span>
          </div>
          <NoteInput
            value={c.snow?.note}
            onChange={(note) => set("snow", { ...c.snow, note })}
            placeholder="Accumuli, croste, segni di valanghe…"
          />
        </section>
      ) : null}

      {fields.includes("weather") ? (
        <section>
          <h3 className="ui-eyebrow mb-1.5">{CONDITION_FIELD_LABELS.weather}</h3>
          <Chips
            options={WEATHER_SKIES}
            labels={WEATHER_SKY_LABELS}
            value={c.weather?.sky}
            onChange={(sky) => set("weather", { ...c.weather, sky })}
          />
          <div className="mt-1.5">
            <Chips options={WINDS} labels={WIND_LABELS} value={c.weather?.wind} onChange={(wind) => set("weather", { ...c.weather, wind })} />
          </div>
          <NoteInput value={c.weather?.note} onChange={(note) => set("weather", { ...c.weather, note })} placeholder="Temperature, visibilità…" />
        </section>
      ) : null}

      {fields.includes("access") ? (
        <section>
          <h3 className="ui-eyebrow mb-1.5">{CONDITION_FIELD_LABELS.access}</h3>
          <div className="flex gap-1.5">
            <button
              type="button"
              aria-pressed={c.access?.ok === true}
              className="ui-chip !min-h-[28px] !text-[12px]"
              onClick={() => set("access", { ...c.access, ok: c.access?.ok === true ? undefined : true })}
            >
              Strade ok
            </button>
            <button
              type="button"
              aria-pressed={c.access?.ok === false}
              className="ui-chip !min-h-[28px] !text-[12px]"
              onClick={() => set("access", { ...c.access, ok: c.access?.ok === false ? undefined : false })}
            >
              Problemi
            </button>
          </div>
          <NoteInput
            value={c.access?.note}
            onChange={(note) => set("access", { ...c.access, note })}
            placeholder="Catene, strada chiusa, parcheggio pieno…"
          />
        </section>
      ) : null}

      {fields.includes("trail") ? (
        <section>
          <h3 className="ui-eyebrow mb-1.5">{CONDITION_FIELD_LABELS.trail}</h3>
          <Chips
            options={TRAIL_STATES}
            labels={TRAIL_STATE_LABELS}
            value={c.trail?.state}
            onChange={(state) => set("trail", { ...c.trail, state })}
          />
          <NoteInput value={c.trail?.note} onChange={(note) => set("trail", { ...c.trail, note })} placeholder="Fango, alberi caduti, segnaletica…" />
        </section>
      ) : null}

      <section>
        <h3 className="ui-eyebrow mb-1.5">Racconto</h3>
        <textarea
          value={story}
          onChange={(e) => setStory(e.target.value)}
          rows={6}
          placeholder="Com'è andata? Orari, sensazioni, cosa rifaresti…"
          className="ui-input w-full !min-h-[120px] !py-2 !text-[13px]"
        />
      </section>

      <section>
        <h3 className="ui-eyebrow mb-1.5">Valutazione</h3>
        <div className="flex gap-1" role="radiogroup" aria-label="Valutazione">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={c.rating === n}
              aria-label={`${n} su 5`}
              onClick={() => set("rating", c.rating === n ? undefined : n)}
              className={`text-xl ${c.rating != null && n <= c.rating ? "text-amber-400" : "text-[color:var(--hmr-faint)]"}`}
            >
              ★
            </button>
          ))}
        </div>
      </section>

      {err ? <p className="text-[12px] text-[color:var(--hmr-danger)]">{err}</p> : null}
      <div className="flex gap-2">
        {onCancel ? (
          <button type="button" className="ui-btn flex-1" onClick={onCancel}>
            Annulla
          </button>
        ) : null}
        <button type="button" disabled={busy} className="ui-btn ui-btn-primary flex-1" onClick={() => void save()}>
          {busy ? "Salvo…" : outing.status === "done" ? "Aggiorna resoconto" : "Salva resoconto e segna come fatta"}
        </button>
      </div>
    </div>
  );
}
