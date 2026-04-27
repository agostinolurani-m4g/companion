import type { HTMLAttributes } from "react";

type Props = {
  /** Mostra il sottotitolo sotto il nome. */
  compact?: boolean;
} & HTMLAttributes<HTMLDivElement>;

/**
 * Marchio Sentiero: sentiero stilizzato + wordmark.
 * Palette: teal su fondo scuro (aria montagna, calma).
 */
export function BrandMark({ className = "", compact = false, ...rest }: Props) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`} {...rest}>
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        className="shrink-0 text-brand-accent"
        aria-hidden
      >
        <circle cx="16" cy="16" r="15" fill="none" className="stroke-brand-border" strokeWidth="1" />
        <path
          d="M6 22 L12 10 L16 16 L22 8 L26 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="10" r="1.5" fill="currentColor" />
        <circle cx="22" cy="8" r="1.5" fill="currentColor" className="opacity-70" />
      </svg>
      <div className="min-w-0 leading-tight">
        <div className="font-semibold tracking-tight text-brand-text">Sentiero</div>
        {!compact ? (
          <div className="text-[10px] font-medium tracking-wide text-brand-muted">
            Itinerari outdoor, in chiaro
          </div>
        ) : null}
      </div>
    </div>
  );
}
