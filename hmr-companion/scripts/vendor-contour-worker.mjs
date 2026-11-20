/**
 * Genera public/vendor/maplibre-contour-worker.js dal dist originale di maplibre-contour.
 *
 * maplibre-contour crea il worker a runtime serializzando le proprie funzioni (`fn.toString()`)
 * in un Blob. Il bundler di Next trasforma quel codice e ci inietta riferimenti a helper/moduli
 * esterni: nel Blob non esistono, il worker muore in silenzio e le richieste vanno in "timed out".
 * Qui ricostruiamo lo stesso bundle dal file NON trasformato e lo serviamo come file statico
 * (contourLayer.ts imposta `mlcontour.workerUrl`).
 *
 * Eseguito da `predev`/`prebuild`; idempotente.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const pkgDir = path.join(process.cwd(), "node_modules", "maplibre-contour");
const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const src = fs.readFileSync(path.join(pkgDir, "dist", "index.mjs"), "utf8");

const marker = 'if (typeof window !== "undefined") {';
if (!src.includes(marker) || !src.includes("var workerBundleString")) {
  console.error("[contour-worker] struttura di maplibre-contour/dist/index.mjs cambiata: aggiorna lo script");
  process.exit(1);
}

// Esegue il dist in una sandbox catturando la stringa del worker invece di creare il Blob.
const patched = src
  .replace(marker, "globalThis.__workerBundle = workerBundleString; if (false) {")
  .replace(/export\s*\{[^}]*\};?\s*$/, "");
const sandbox = { console, Blob, URL, setTimeout, clearTimeout };
vm.createContext(sandbox);
try {
  vm.runInContext(patched, sandbox, { filename: "maplibre-contour.mjs" });
} catch (e) {
  // Il chunk principale può fallire fuori dal browser: conta solo aver catturato la stringa del worker.
  if (typeof sandbox.__workerBundle !== "string") throw e;
}
const bundle = sandbox.__workerBundle;
if (typeof bundle !== "string" || bundle.length < 1000) {
  console.error("[contour-worker] bundle del worker non trovato");
  process.exit(1);
}

const outDir = path.join(process.cwd(), "public", "vendor");
const outFile = path.join(outDir, "maplibre-contour-worker.js");
const content = `/* maplibre-contour ${version} worker — generato da scripts/vendor-contour-worker.mjs, non modificare */\n${bundle}\n`;
fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(outFile) || fs.readFileSync(outFile, "utf8") !== content) {
  fs.writeFileSync(outFile, content);
  console.log(`[contour-worker] scritto public/vendor/maplibre-contour-worker.js (${(content.length / 1024).toFixed(0)} KB)`);
}
