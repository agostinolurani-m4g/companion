"use client";

export type MapPointKind = "waypoint" | "destination" | "lodging";

type Props = {
  open: boolean;
  name: string;
  onNameChange: (name: string) => void;
  pointKind: MapPointKind;
  onPointKindChange: (k: MapPointKind) => void;
  imageUrl: string;
  onImageUrlChange: (url: string) => void;
  websiteUrl: string;
  onWebsiteUrlChange: (url: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function MapClickSheet({
  open,
  name,
  onNameChange,
  pointKind,
  onPointKindChange,
  imageUrl,
  onImageUrlChange,
  websiteUrl,
  onWebsiteUrlChange,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  const toggleBase = "flex-1 rounded px-1.5 py-1.5 text-[9px] font-medium sm:text-[10px] ";
  const toggleOn = "bg-emerald-700 text-white";
  const toggleOff = "bg-zinc-800 text-zinc-400 hover:bg-zinc-700";

  const hint =
    pointKind === "waypoint"
      ? "Tappa intermedia (POI) lungo il tragitto."
      : pointKind === "destination"
        ? "Destinazione principale (fine obiettivo)."
        : "Rifugio: URL foto e sito web (prenotazioni / info).";

  return (
    <div className="pointer-events-auto absolute bottom-2 left-1/2 z-[50] w-[min(100%-0.75rem,22rem)] -translate-x-1/2 rounded-lg border border-zinc-600 bg-zinc-900/95 p-2.5 shadow-lg backdrop-blur-sm">
      <p className="mb-2 text-center text-[11px] font-medium text-zinc-300">Punto sulla mappa</p>
      <div className="mb-2 flex flex-wrap gap-1">
        <button
          type="button"
          className={toggleBase + (pointKind === "waypoint" ? toggleOn : toggleOff)}
          onClick={() => onPointKindChange("waypoint")}
        >
          Sul percorso
        </button>
        <button
          type="button"
          className={toggleBase + (pointKind === "destination" ? toggleOn : toggleOff)}
          onClick={() => onPointKindChange("destination")}
        >
          Destinazione
        </button>
        <button
          type="button"
          className={toggleBase + (pointKind === "lodging" ? toggleOn : toggleOff)}
          onClick={() => onPointKindChange("lodging")}
        >
          Rifugio
        </button>
      </div>
      <p className="mb-1.5 text-[10px] leading-snug text-zinc-500">{hint}</p>
      <input
        className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={pointKind === "lodging" ? "Nome rifugio" : "Nome"}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
          if (e.key === "Escape") onCancel();
        }}
      />
      {pointKind === "lodging" ? (
        <>
          <label className="mb-1 block text-[10px] text-zinc-500">Sito web rifugio</label>
          <input
            className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            value={websiteUrl}
            onChange={(e) => onWebsiteUrlChange(e.target.value)}
            placeholder="https://… (opzionale)"
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
              if (e.key === "Escape") onCancel();
            }}
          />
          <label className="mb-1 block text-[10px] text-zinc-500">URL foto</label>
          <input
            className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            value={imageUrl}
            onChange={(e) => onImageUrlChange(e.target.value)}
            placeholder="https://… (opzionale)"
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
              if (e.key === "Escape") onCancel();
            }}
          />
        </>
      ) : null}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          className="rounded bg-zinc-700 px-2 py-1 text-[11px] text-zinc-200"
          onClick={onCancel}
        >
          Annulla
        </button>
        <button
          type="button"
          className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white"
          onClick={onConfirm}
        >
          Aggiungi
        </button>
      </div>
    </div>
  );
}
