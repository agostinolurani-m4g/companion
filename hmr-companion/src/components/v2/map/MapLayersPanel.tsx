"use client";

import { useEffect } from "react";
import Icon from "@/components/v2/ui/Icon";
import { AVAILABLE_OVERLAYS } from "@/lib/map/overlay-urls";
import { listBaseMaps, type BaseStyleId } from "@/lib/map/topo-style";
import type { MapOverlayId } from "@/lib/sports";
import type { MapPrefs } from "./useMapPrefs";

type Props = {
  open: boolean;
  onClose: () => void;
  base: BaseStyleId;
  onBaseChange: (id: BaseStyleId) => void;
  prefs: MapPrefs;
  onPrefsChange: (patch: Partial<MapPrefs>) => void;
  view3d: boolean;
  onView3dChange: (v: boolean) => void;
  overlays: Partial<Record<MapOverlayId, boolean>>;
  onToggleOverlay: (id: MapOverlayId) => void;
  recommended: readonly MapOverlayId[];
  sportLabel?: string;
  baseHasOwnRelief: boolean;
  mapMode: "auto" | "light" | "dark";
  onMapModeChange: (m: "auto" | "light" | "dark") => void;
  appTheme: "light" | "dark";
  onAppThemeChange: (t: "light" | "dark") => void;
  baseSupportsDark: boolean;
};

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-[color:var(--hmr-accent)]" : "bg-[color:var(--hmr-border)]"
      }`}
    >
      <span
        className={`absolute h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </span>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onClick,
  swatch,
  badge,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onClick: () => void;
  swatch?: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--hmr-elev)]"
    >
      {swatch ? (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: swatch }} aria-hidden />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          {label}
          {badge ? (
            <span className="rounded-full bg-[color:var(--hmr-accent-dim)] px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-[color:var(--hmr-accent)]">
              {badge}
            </span>
          ) : null}
        </span>
        {hint ? <span className="block truncate text-[11.5px] text-[color:var(--hmr-muted)]">{hint}</span> : null}
      </span>
      <Switch on={on} />
    </button>
  );
}

/** Selettore livelli: basemap con anteprima, rilievo, 3D e sovrapposizioni tematiche. */
export default function MapLayersPanel({
  open,
  onClose,
  base,
  onBaseChange,
  prefs,
  onPrefsChange,
  view3d,
  onView3dChange,
  overlays,
  onToggleOverlay,
  recommended,
  sportLabel,
  baseHasOwnRelief,
  mapMode,
  onMapModeChange,
  appTheme,
  onAppThemeChange,
  baseSupportsDark,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const bases = listBaseMaps();
  const sortedOverlays = [...AVAILABLE_OVERLAYS].sort(
    (a, b) => Number(recommended.includes(b.id)) - Number(recommended.includes(a.id)),
  );

  return (
    <>
      <button
        type="button"
        aria-label="Chiudi livelli"
        className="absolute inset-0 z-40 cursor-default bg-black/20 sm:bg-transparent"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Livelli mappa"
        className="ui-glass v2-anim-in ui-scroll absolute inset-x-2 top-2 z-50 max-h-[calc(100%-1rem)] overflow-y-auto rounded-lg p-3 sm:inset-x-auto sm:right-[3.75rem] sm:top-3 sm:max-h-[calc(100%-1.5rem)] sm:w-[340px]"
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[15px] font-bold tracking-tight">Mappa</h2>
          <button type="button" className="ui-icon-btn !h-8 !w-8" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>

        <p className="ui-eyebrow px-1 pb-1.5">Mappa di base</p>
        <div className="grid grid-cols-4 gap-2 px-0.5">
          {bases.map((b) => {
            const on = b.id === base;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onBaseChange(b.id)}
                aria-pressed={on}
                title={b.hint}
                className="group flex flex-col items-center gap-1"
              >
                <span
                  className={`relative block aspect-square w-full overflow-hidden rounded-xl ring-2 transition ${
                    on ? "ring-[color:var(--hmr-accent)]" : "ring-transparent group-hover:ring-[color:var(--hmr-border)]"
                  }`}
                >
                  {b.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.thumb} alt="" className="h-full w-full scale-125 object-cover" style={{ background: b.swatch }} />
                  ) : (
                    <span className="block h-full w-full" style={{ background: b.swatch }} />
                  )}
                  {on ? (
                    <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-[color:var(--hmr-accent)] text-[color:var(--hmr-accent-ink)]">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" aria-hidden>
                        <path d="m5 12 5 5 9-10" />
                      </svg>
                    </span>
                  ) : null}
                </span>
                <span
                  className={`text-[11px] font-semibold ${on ? "text-[color:var(--hmr-accent)]" : "text-[color:var(--hmr-muted)]"}`}
                >
                  {b.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="my-3 h-px bg-[color:var(--hmr-border)]/50" />
        <p className="ui-eyebrow px-1 pb-1.5">Aspetto</p>
        <div className="space-y-2 px-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px]">Mappa</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Aspetto mappa">
              {(["auto", "light", "dark"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mapMode === m}
                  onClick={() => onMapModeChange(m)}
                  disabled={!baseSupportsDark && m !== "auto"}
                  className="ui-chip !min-h-[28px] !px-2.5 !text-[12px]"
                >
                  {m === "auto" ? "Come l'app" : m === "light" ? "Chiara" : "Scura"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px]">App</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Tema app">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={appTheme === t}
                  onClick={() => onAppThemeChange(t)}
                  className="ui-chip !min-h-[28px] !px-2.5 !text-[12px]"
                >
                  {t === "light" ? "Chiaro" : "Scuro"}
                </button>
              ))}
            </div>
          </div>
          {!baseSupportsDark ? (
            <p className="text-[11.5px] text-[color:var(--hmr-faint)]">Questa mappa non ha una variante chiara/scura.</p>
          ) : null}
        </div>

        <div className="my-3 h-px bg-[color:var(--hmr-border)]/50" />
        <p className="ui-eyebrow px-1 pb-1">Rilievo</p>
        <ToggleRow
          label="Terreno 3D"
          hint="Inclina la mappa con il rilievo reale"
          on={view3d}
          onClick={() => onView3dChange(!view3d)}
        />
        <ToggleRow
          label="Curve di livello"
          hint="Isoipse ogni 10–200 m con quote"
          on={prefs.contours}
          onClick={() => onPrefsChange({ contours: !prefs.contours })}
        />
        {!baseHasOwnRelief ? (
          <>
            <ToggleRow
              label="Ombreggiatura"
              hint="Rilievo ombreggiato dei versanti"
              on={prefs.hillshade}
              onClick={() => onPrefsChange({ hillshade: !prefs.hillshade })}
            />
            <ToggleRow
              label="Tinta altimetrica"
              hint="Colori per fasce di quota"
              on={prefs.tint}
              onClick={() => onPrefsChange({ tint: !prefs.tint })}
            />
          </>
        ) : null}

        <div className="my-3 h-px bg-[color:var(--hmr-border)]/50" />
        <p className="ui-eyebrow px-1 pb-1">Heatmap</p>
        <ToggleRow
          label="I miei giri"
          hint="Le tue attività importate (Strava, GPX…): visibile solo a te"
          swatch="#3182ce"
          on={prefs.heatMe}
          onClick={() => onPrefsChange({ heatMe: !prefs.heatMe })}
        />
        <ToggleRow
          label="Community"
          hint="Dove passano di più gli altri utenti"
          swatch="#f03b20"
          on={prefs.heatCommunity}
          onClick={() => onPrefsChange({ heatCommunity: !prefs.heatCommunity })}
        />

        <div className="my-3 h-px bg-[color:var(--hmr-border)]/50" />
        <p className="ui-eyebrow px-1 pb-1">Sovrapposizioni</p>
        {sortedOverlays.map((o) => (
          <ToggleRow
            key={o.id}
            label={o.label}
            hint={o.hint}
            swatch={o.swatch}
            on={!!overlays[o.id]}
            onClick={() => onToggleOverlay(o.id)}
            badge={recommended.includes(o.id) && sportLabel ? sportLabel : undefined}
          />
        ))}
      </div>
    </>
  );
}
