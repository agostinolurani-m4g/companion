#!/usr/bin/env node
/**
 * WCAG contrast ratio between two colors.
 *
 *   node contrast.mjs "#7fb8ae" "#e9e6e1"
 *   node contrast.mjs "#7fb8ae" light dark     # against the basemap samples
 *
 * Accepts #rgb, #rrggbb, rgb(r,g,b), rgba(r,g,b,a) (alpha composited over the background).
 * Shortcuts: light = #e9e6e1 (topo light paper/settlement), dark = #1a1e22 (topo dark paper).
 * Thresholds: text 4.5:1 (AA), large text / UI graphics and map lines 3:1.
 */
const SAMPLES = { light: "#e9e6e1", dark: "#1a1e22", white: "#ffffff", black: "#000000" };

function parse(input) {
  const s = (SAMPLES[input] ?? input).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b, a = "1"] = m[1].split(",").map((x) => x.trim());
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  }
  throw new Error(`colore non riconosciuto: ${input}`);
}

function over(fg, bg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

function luminance({ r, g, b }) {
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function ratio(fgIn, bgIn) {
  const bg = parse(bgIn);
  const fg = over(parse(fgIn), bg);
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const [fg, ...bgs] = process.argv.slice(2);
if (!fg || bgs.length === 0) {
  console.error('uso: node contrast.mjs <fg> <bg> [bg2 ...]   (bg può essere "light" o "dark")');
  process.exit(1);
}
for (const bg of bgs) {
  const r = ratio(fg, bg);
  const verdict = r >= 4.5 ? "AA testo" : r >= 3 ? "ok linee/UI, non testo piccolo" : "INSUFFICIENTE";
  console.log(`${fg} su ${bg}: ${r.toFixed(2)}:1  → ${verdict}`);
}
