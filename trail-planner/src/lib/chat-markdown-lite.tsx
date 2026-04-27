import type { ReactNode } from "react";

/** Sostituisce `**testo**` con grassetto; resto invariato con `whitespace-pre-wrap`. */
export function renderMarkdownLite(text: string, keyPrefix = ""): ReactNode {
  const nodes: ReactNode[] = [];
  const re = /\*\*([\s\S]*?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<span key={`${keyPrefix}t${k++}`}>{text.slice(last, m.index)}</span>);
    }
    nodes.push(
      <strong key={`${keyPrefix}s${k++}`} className="font-semibold text-zinc-50">
        {m[1]}
      </strong>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(<span key={`${keyPrefix}t${k++}`}>{text.slice(last)}</span>);
  }
  return nodes.length ? nodes : text;
}
