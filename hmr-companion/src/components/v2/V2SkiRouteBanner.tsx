"use client";

type Props = {
  name: string;
  lengthKm: number;
  elevGainM?: number;
  elevLossM?: number;
  owner?: string;
  source?: string | null;
  sourceUrl?: string | null;
  license?: string | null;
  onOpen?: () => void;
  onRegisterOuting?: () => void;
  onDismiss?: () => void;
};

const SOURCE_LABELS: Record<string, string> = {
  camptocamp: "camptocamp.org",
  gulliver: "Gulliver",
  user: "Utente",
};

export default function V2SkiRouteBanner({
  name,
  lengthKm,
  elevGainM,
  elevLossM,
  owner,
  source,
  sourceUrl,
  license,
  onOpen,
  onRegisterOuting,
  onDismiss,
}: Props) {
  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 max-w-lg rounded-xl border border-[color:var(--hmr-border)]/80 bg-slate-950/90 p-3 shadow-lg backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-white">{name}</h2>
          <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-300">
            <span>{lengthKm.toFixed(1)} km</span>
            {elevGainM != null && elevGainM > 0 ? <span>D+ {Math.round(elevGainM)} m</span> : null}
            {elevLossM != null && elevLossM > 0 ? <span>D− {Math.round(elevLossM)} m</span> : null}
            {owner ? <span>· {owner}</span> : null}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {source ? (
              <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-200">
                {SOURCE_LABELS[source] ?? source}
                {license ? ` · ${license}` : null}
              </span>
            ) : null}
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-sky-300 underline"
              >
                Fonte
              </a>
            ) : null}
            <span className="inline-flex items-center gap-2 text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#22c55e]" />
                Partenza
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#eab308]" />
                Vetta
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" />
                Arrivo
              </span>
            </span>
          </div>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Chiudi"
          >
            ✕
          </button>
        ) : null}
      </div>
      {onOpen || onRegisterOuting ? (
        <div className="mt-2.5 flex gap-2">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="flex-1 rounded-lg bg-[color:var(--hmr-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-bg)]"
            >
              Apri percorso
            </button>
          ) : null}
          {onRegisterOuting ? (
            <button
              type="button"
              onClick={onRegisterOuting}
              className="flex-1 rounded-lg border border-[color:var(--hmr-accent)]/60 px-3 py-1.5 text-xs font-medium text-[color:var(--hmr-accent)]"
            >
              Nuova gita
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
