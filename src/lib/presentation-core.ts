import { studioWriteFile } from "./studio-core";

const REVEAL_VERSION = "4.6.1";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bodyToHtml(body: string): string {
  return escapeHtml(body).replace(/\n/g, "<br/>");
}

export type RevealSlide = {
  heading?: string | null;
  body: string;
};

/**
 * HTML standalone Reveal.js (CDN) — apribile in browser da output/&lt;session&gt;/...
 */
export function buildRevealDeckHtml(deckTitle: string, slides: RevealSlide[]): string {
  const sections = slides
    .map((s) => {
      const h = s.heading?.trim()
        ? `<h2>${escapeHtml(s.heading.trim())}</h2>`
        : "";
      const b = bodyToHtml(s.body.trim() || " ");
      return `<section>${h}<div class="slide-body" style="text-align:left;font-size:0.85em">${b}</div></section>`;
    })
    .join("\n");

  const title = escapeHtml(deckTitle.trim() || "Presentazione");

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@${REVEAL_VERSION}/dist/reveal.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@${REVEAL_VERSION}/dist/theme/white.css" />
  <style>
    .reveal .slides section { text-align: left; }
    .reveal h1, .reveal h2 { text-transform: none; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
      <section><h1>${title}</h1><p><small>Generato da Studio Builder — bozza</small></p></section>
${sections}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@${REVEAL_VERSION}/dist/reveal.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      slideNumber: true,
      transition: 'slide',
    });
  </script>
</body>
</html>`;
}

export function writeRevealPresentation(
  cwd: string,
  sessionId: string,
  relativePath: string,
  deckTitle: string,
  slides: RevealSlide[]
): { path: string; url_hint: string } {
  if (!slides.length) {
    throw new Error("serve almeno una slide (oltre alla copertina generata)");
  }
  const html = buildRevealDeckHtml(deckTitle, slides);
  const r = studioWriteFile(cwd, sessionId, relativePath, html);
  const rel = relativePath.replace(/^\//, "").replace(/\\/g, "/");
  return {
    path: r.path,
    url_hint: `/output/${sessionId}/${rel}`,
  };
}
