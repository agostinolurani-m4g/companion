/**
 * Miniatura reale della basemap "topo" per il selettore livelli (MapLayersPanel).
 *
 * Renderizza in Chromium headless (Playwright) una mappa MapLibre con lo stile
 * `buildSwissTopoStyle("light")` più il rilievo runtime (ombreggiatura DEM Mapterhorn
 * e, con `--tint`, tinta altimetrica), inseriti dalla stessa `applyRelief` usata
 * dall'app su una mappa "finta" che modifica lo stile in memoria. Non serve il dev server:
 * maplibre-gl viene caricato da node_modules.
 *
 *   npm run thumbs            → public/basemaps/topo.png (come i default dell'app: tinta spenta)
 *   npm run thumbs -- --tint  → con tinta altimetrica
 *
 * Primo avvio: `npx playwright install chromium`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import type { Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import { buildSwissTopoStyle } from "../src/lib/map/swiss-style";
import { applyRelief } from "../src/lib/map/topo-style";

/** Tile delle altre miniature (Valchiavenna/Bregaglia): la mappa è centrata sul suo centro. */
const THUMB_TILE = { z: 12, x: 2155, y: 1451 };
const ZOOM = 12;
/** Lato visualizzato in MapLayersPanel (griglia a 4 colonne: ~72 px desktop, ~83 px mobile). */
const DISPLAY_PX = 80;
/** 2× per i display retina: lato del PNG finale. */
const RENDER_PX = DISPLAY_PX * 2;
/**
 * Lato della vista catturata a z12, in px CSS. A z12 (mondo da 512·2^z px) la tile 2155/1451
 * è larga 512 px: con 512 la miniatura copre la stessa area delle altre (tile raster z12),
 * con 160 solo ~2 km di versante, spesso senza strade né sentieri (i sentieri partono da z12).
 * Lo screenshot viene poi ridotto a RENDER_PX.
 */
const VIEW_PX = Number(process.argv.find((a) => a.startsWith("--view="))?.slice(7)) || 512;
const TIMEOUT_MS = 60_000;

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public", "basemaps", "topo.png");

function tileCenter({ z, x, y }: typeof THUMB_TILE): [number, number] {
  const n = 2 ** z;
  const lng = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

/** Applica `applyRelief` (codice dell'app) a uno stile, tramite una mappa minimale in memoria. */
function styleWithRelief(base: StyleSpecification, tint: boolean): StyleSpecification {
  const style = structuredClone(base);
  const layers = style.layers as Array<{ id: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> }>;
  const layer = (id: string) => layers.find((l) => l.id === id);
  const mock = {
    style,
    getStyle: () => style,
    getSource: (id: string) => style.sources[id],
    addSource: (id: string, src: StyleSpecification["sources"][string]) => {
      style.sources[id] = src;
    },
    getLayer: layer,
    addLayer: (l: (typeof layers)[number], before?: string) => {
      const i = before ? layers.findIndex((x) => x.id === before) : -1;
      if (i < 0) layers.push(l);
      else layers.splice(i, 0, l);
    },
    setLayoutProperty: (id: string, k: string, v: unknown) => {
      const l = layer(id);
      if (l) l.layout = { ...(l.layout ?? {}), [k]: v };
    },
    setPaintProperty: (id: string, k: string, v: unknown) => {
      const l = layer(id);
      if (l) l.paint = { ...(l.paint ?? {}), [k]: v };
    },
    on: () => mock,
    getZoom: () => ZOOM,
    getBounds: () => ({ getWest: () => -180, getSouth: () => -85, getEast: () => 180, getNorth: () => 85 }),
  };
  applyRelief(mock as unknown as MaplibreMap, { hillshade: true, tint, dark: false, winter: false });
  return style;
}

async function main() {
  const tint = process.argv.includes("--tint");
  const style = styleWithRelief(buildSwissTopoStyle("light"), tint);
  const center = tileCenter(THUMB_TILE);

  const require = createRequire(__filename);
  const mlDir = path.dirname(require.resolve("maplibre-gl/package.json"));

  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: VIEW_PX, height: VIEW_PX }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("[page]", e.message));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") console.error(`[console.${m.type()}]`, m.text());
    });

    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="map"></div></body></html>`,
    );
    await page.addStyleTag({ path: path.join(mlDir, "dist", "maplibre-gl.css") });
    await page.addScriptTag({ path: path.join(mlDir, "dist", "maplibre-gl.js") });

    const result = await page.evaluate(
      ({ styleJson, center, zoom, timeout }) =>
        new Promise<{ ok: boolean; reason?: string; layers: number }>((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ml = (window as any).maplibregl;
          const map = new ml.Map({
            container: "map",
            style: JSON.parse(styleJson),
            center,
            zoom,
            interactive: false,
            attributionControl: false,
            fadeDuration: 0,
            canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
          });
          const timer = setTimeout(() => resolve({ ok: false, reason: "timeout", layers: 0 }), timeout);
          map.on("error", (e: { error?: Error }) => console.error("map error:", e.error?.message ?? String(e)));
          map.once("load", () => {
            map.once("idle", () => {
              clearTimeout(timer);
              resolve({ ok: map.areTilesLoaded(), layers: map.getStyle().layers.length });
            });
          });
        }),
      // Stile serializzato: i tipi di StyleSpecification sono troppo profondi per page.evaluate.
      { styleJson: JSON.stringify(style), center, zoom: ZOOM, timeout: TIMEOUT_MS },
    );
    if (!result.ok) throw new Error(`Mappa non pronta: ${result.reason ?? "tile non caricate"}`);

    const raw = await page.locator("#map").screenshot({ type: "png" });
    if (process.env.THUMB_RAW) writeFileSync(process.env.THUMB_RAW, raw); // debug: screenshot a piena risoluzione
    const png = await sharp(raw)
      .resize(RENDER_PX, RENDER_PX, { kernel: "lanczos3" })
      .png({ palette: true, quality: 92, colours: 256, compressionLevel: 9, effort: 10 })
      .toBuffer();

    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, png);
    console.log(
      `Salvato ${path.relative(ROOT, OUT)}: ${RENDER_PX}×${RENDER_PX} px, ${(png.length / 1024).toFixed(1)} KB ` +
        `(vista ${VIEW_PX} px, ${result.layers} layer, centro ${center.map((n) => n.toFixed(4)).join(", ")}, z${ZOOM}${tint ? ", tinta" : ""})`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
