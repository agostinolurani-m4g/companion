/**
 * Colori delle linee dati (percorsi, tracce) adattati alla basemap.
 *
 * I colori sport (src/lib/sports.ts) sono pastello: perfetti nei pannelli e sulla mappa scura,
 * ma sulla carta topo chiara con ombreggiatura scendono a 1.5–2.8:1 di contrasto e la traccia
 * sparisce. Qui, solo per la mappa chiara, si scurisce il colore mantenendo la tinta (OKLCH)
 * finché non raggiunge MIN_CONTRAST contro il campione di carta chiara.
 */

/**
 * Sfondi chiari tipici sotto le tracce: carta avorio e bosco (il caso peggiore).
 * Allineati a SWISS.paper / SWISS.forest in swiss-style.ts.
 */
export const LIGHT_MAP_SAMPLES = ["#f6f3ea", "#d4e3c2"] as const;
/** Soglia WCAG per elementi grafici (3:1) con un piccolo margine per l'ombreggiatura. */
export const MIN_CONTRAST = 3.2;

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const [l1, l2] = [relativeLuminance(ca), relativeLuminance(cb)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/* OKLab ⇄ sRGB lineare (Björn Ottosson). */
function rgbToOklch(rgb: Rgb): { L: number; C: number; h: number } {
  const r = toLinear(rgb.r), g = toLinear(rgb.g), b = toLinear(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToRgb({ L, C, h }: { L: number; C: number; h: number }): Rgb {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

const cache = new Map<string, string>();

/** Contrasto minimo della linea contro tutti gli sfondi chiari campione. */
export function minLightContrast(color: string): number {
  return Math.min(...LIGHT_MAP_SAMPLES.map((bg) => contrastRatio(color, bg)));
}

function inGamut({ r, g, b }: Rgb): boolean {
  return [r, g, b].every((v) => v >= -0.5 && v <= 255.5);
}

/** Croma massima riproducibile in sRGB per luminosità e tinta date (ricerca binaria). */
function maxChroma(L: number, h: number): number {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgb({ L, C: mid, h }))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Colore della linea per la basemap corrente. Sulla mappa scura resta il colore originale.
 * Sulla chiara il pastello diventa la versione *vivace* della stessa tinta: croma spinta verso
 * il massimo sRGB (un colore saturo si stacca da carta e bosco senza diventare "fango") e
 * luminosità abbassata solo quanto serve per MIN_CONTRAST. Colori non esadecimali passano invariati.
 */
export function mapLineColor(color: string, dark: boolean): string {
  if (dark) return color;
  const key = color.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const rgb = parseHex(color);
  if (!rgb || minLightContrast(color) >= MIN_CONTRAST) {
    cache.set(key, color);
    return color;
  }
  const base = rgbToOklch(rgb);
  let out = color;
  for (let L = Math.min(base.L, 0.72); L > 0.25; L -= 0.005) {
    // 85% della croma massima: vivace ma non fluo.
    const C = Math.max(base.C, 0.85 * maxChroma(L, base.h));
    out = toHex(oklchToRgb({ L, C, h: base.h }));
    if (minLightContrast(out) >= MIN_CONTRAST) break;
  }
  cache.set(key, out);
  return out;
}

/**
 * Adatta la proprietà `color` delle feature alla basemap. Le feature senza colore ricevono
 * `fallback` (anche lui adattato), così la linea non dipende dal colore di default dello stile.
 */
export function adaptLineColors(
  fc: GeoJSON.FeatureCollection,
  dark: boolean,
  fallback: string,
): GeoJSON.FeatureCollection {
  if (fc.features.length === 0) return fc;
  return {
    ...fc,
    features: fc.features.map((f) => {
      const raw = typeof f.properties?.color === "string" ? (f.properties.color as string) : fallback;
      return { ...f, properties: { ...(f.properties ?? {}), color: mapLineColor(raw, dark) } };
    }),
  };
}
