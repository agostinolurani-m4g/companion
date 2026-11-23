/**
 * Rilievo pre-calcolato sul corridoio della traccia (issue #1).
 *
 *   npm run ingest   # la traccia deve essere nel DB
 *   npm run relief   # → public/relief/hmr-relief.pmtiles + manifest.json
 *
 * 1. Legge la traccia da SQLite e calcola le celle del corridoio (buffer attorno al percorso).
 * 2. Scrive data/relief/job.json + corridor.geojson.
 * 3. Esegue scripts/relief/build-relief.sh con GDAL nativo (se `gdaldem` è nel PATH)
 *    oppure nel container ufficiale ghcr.io/osgeo/gdal (Docker).
 * 4. Scrive il manifest letto dal client (bounds, zoom, celle del corridoio).
 *
 * Env: HMR_RELIEF_TRACK_ID (default hmr-2026), HMR_RELIEF_BUFFER_KM (8), HMR_RELIEF_CELL_DEG (0.02),
 *      HMR_RELIEF_GDAL_IMAGE, HMR_RELIEF_NATIVE=1 per forzare GDAL locale.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../src/lib/db";
import { HMR_OFFICIAL_TRACK_ID } from "../../src/lib/track-ingest";
import { type Bbox, bboxToMercator, cellsToGeoJson, corridorCells, type ReliefManifest } from "../../src/lib/map/relief";

const ROOT = process.cwd();
const JOB_DIR = path.join(ROOT, "data", "relief");
const OUT_DIR = path.join(ROOT, "public", "relief");
const GDAL_IMAGE = process.env.HMR_RELIEF_GDAL_IMAGE?.trim() || "ghcr.io/osgeo/gdal:ubuntu-small-3.10.3";

/** Zoom del DEM sorgente (Mapterhorn planet, copertura globale) e range dell'archivio in uscita. */
const SOURCE_ZOOM = 12;
const OUT_MINZOOM = 10;
const OUT_MAXZOOM = 13;

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function hasNativeGdal(): boolean {
  if (process.env.HMR_RELIEF_NATIVE === "1") return true;
  const r = spawnSync(process.platform === "win32" ? "where" : "which", ["gdaldem"], { stdio: "ignore" });
  return r.status === 0;
}

function main() {
  const trackId = process.env.HMR_RELIEF_TRACK_ID?.trim() || HMR_OFFICIAL_TRACK_ID;
  const bufferKm = num("HMR_RELIEF_BUFFER_KM", 8);
  const cellDeg = num("HMR_RELIEF_CELL_DEG", 0.02);

  const row = getDb().prepare("SELECT coords_json FROM tracks WHERE id = ?").get(trackId) as
    | { coords_json: string }
    | undefined;
  if (!row) {
    console.error(`[relief] traccia "${trackId}" assente nel DB: esegui prima npm run ingest`);
    process.exit(1);
  }
  const coords = JSON.parse(row.coords_json) as Array<[number, number, ...unknown[]]>;
  const cells = corridorCells(coords, bufferKm, cellDeg);

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const key of cells) {
    const [i, j] = key.split(":").map(Number);
    w = Math.min(w, i * cellDeg);
    s = Math.min(s, j * cellDeg);
    e = Math.max(e, (i + 1) * cellDeg);
    n = Math.max(n, (j + 1) * cellDeg);
  }
  const bounds: Bbox = [w, s, e, n].map((v) => Number(v.toFixed(5))) as Bbox;

  fs.mkdirSync(JOB_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const merc = bboxToMercator(bounds);
  fs.writeFileSync(
    path.join(JOB_DIR, "job.json"),
    JSON.stringify({ trackId, bounds, merc, sourceZoom: SOURCE_ZOOM, minzoom: OUT_MINZOOM, maxzoom: OUT_MAXZOOM }, null, 2),
  );
  fs.writeFileSync(path.join(JOB_DIR, "corridor.geojson"), JSON.stringify(cellsToGeoJson(cells, cellDeg)));
  console.log(`[relief] ${trackId}: ${cells.length} celle (${cellDeg}°, buffer ${bufferKm} km) · bbox ${bounds.join(", ")}`);

  const shArgs = [
    `${merc.minX}`, `${merc.maxY}`, `${merc.maxX}`, `${merc.minY}`,
    `${SOURCE_ZOOM}`, `${OUT_MINZOOM}`, `${OUT_MAXZOOM}`,
  ];
  const r = hasNativeGdal()
    ? spawnSync("bash", ["scripts/relief/build-relief.sh", ...shArgs], { cwd: ROOT, stdio: "inherit" })
    : spawnSync(
        "docker",
        ["run", "--rm", "-v", `${ROOT}:/w`, "-w", "/w", GDAL_IMAGE, "bash", "scripts/relief/build-relief.sh", ...shArgs],
        { stdio: "inherit" },
      );
  if (r.status !== 0) {
    console.error(`[relief] build-relief.sh fallito (exit ${r.status ?? r.error?.message})`);
    process.exit(1);
  }

  const manifest: ReliefManifest = {
    bounds,
    minzoom: OUT_MINZOOM,
    maxzoom: OUT_MAXZOOM,
    cellDeg,
    cells,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest));
  const size = fs.statSync(path.join(OUT_DIR, "hmr-relief.pmtiles")).size;
  console.log(`[relief] ok → public/relief/hmr-relief.pmtiles (${(size / 1e6).toFixed(1)} MB) + manifest.json`);
}

main();
