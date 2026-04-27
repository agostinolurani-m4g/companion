/**
 * Report di diagnosi per:
 *  - checkpoint: conferma che il proiezione lat/lng su traccia sia coerente con
 *    l'along_km dichiarato nel manuale (e quantifica lo shift "manuale vs GPX").
 *  - resupply: per ciascuna località dichiarata dal manuale, mostriamo dove
 *    cade fisicamente oggi (solo per km dichiarato).
 *  - notable_sections: per ciascuna sezione, stats sul range attuale + scan
 *    esteso ±8 km per capire dove cade effettivamente la salita o la discesa.
 *
 * SOLO LETTURA. Non tocca SQLite, non tocca il seed.
 */
import path from "node:path";
import Database from "better-sqlite3";
import type { Position } from "geojson";
import type { StoredCoord } from "../src/lib/track-coords";
import {
  STATIC_CHECKPOINTS,
  STATIC_RESUPPLY,
  STATIC_SECTIONS,
} from "../src/lib/seed-static";
import {
  nearestPointOnPolyline,
  positionAtKm,
  haversineMeters,
} from "../src/lib/track-geometry";

function findIdxAtKm(coords: StoredCoord[], km: number): number {
  let lo = 0;
  let hi = coords.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (coords[mid][3] < km) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sliceStats(
  coords: StoredCoord[],
  kmStart: number,
  kmEnd: number
): {
  elevStart: number | null;
  elevEnd: number | null;
  minElev: number;
  maxElev: number;
  kmMax: number;
  kmMin: number;
  gain: number;
  loss: number;
  maxUpGrade: number;
  maxDownGrade: number;
} {
  const iStart = findIdxAtKm(coords, kmStart);
  const iEnd = findIdxAtKm(coords, kmEnd);
  const slice = coords.slice(iStart, iEnd + 1);
  let gain = 0;
  let loss = 0;
  let minElev = +Infinity;
  let maxElev = -Infinity;
  let kmMax = kmStart;
  let kmMin = kmStart;
  let prev: number | null = null;
  for (const c of slice) {
    const e = c[2];
    if (e == null) continue;
    if (prev != null) {
      const d = e - prev;
      if (d > 0) gain += d;
      else loss += -d;
    }
    if (e < minElev) {
      minElev = e;
      kmMin = c[3];
    }
    if (e > maxElev) {
      maxElev = e;
      kmMax = c[3];
    }
    prev = e;
  }
  let maxUpGrade = 0;
  let maxDownGrade = 0;
  const GRADE_WINDOW_M = 300;
  for (let i = 0; i < slice.length; i++) {
    const e0 = slice[i][2];
    if (e0 == null) continue;
    let acc = 0;
    for (let j = i + 1; j < slice.length; j++) {
      acc += haversineMeters(
        [slice[j - 1][0], slice[j - 1][1]],
        [slice[j][0], slice[j][1]]
      );
      if (acc >= GRADE_WINDOW_M) {
        const e1 = slice[j][2];
        if (e1 != null) {
          const grade = ((e1 - e0) / acc) * 100;
          if (grade > maxUpGrade) maxUpGrade = grade;
          if (grade < maxDownGrade) maxDownGrade = grade;
        }
        break;
      }
    }
  }
  return {
    elevStart: slice[0]?.[2] ?? null,
    elevEnd: slice[slice.length - 1]?.[2] ?? null,
    minElev,
    maxElev,
    kmMax,
    kmMin,
    gain: Math.round(gain),
    loss: Math.round(loss),
    maxUpGrade: +maxUpGrade.toFixed(1),
    maxDownGrade: +maxDownGrade.toFixed(1),
  };
}

function scanElev(
  coords: StoredCoord[],
  kmFrom: number,
  kmTo: number,
  stepKm: number
): string[] {
  const lines: string[] = [];
  for (let km = kmFrom; km <= kmTo + 1e-9; km += stepKm) {
    const i = findIdxAtKm(coords, km);
    const e = coords[i][2];
    lines.push(
      `    km ${km.toFixed(0).padStart(3)}  ${
        e != null ? e.toFixed(0).padStart(4) : "   ?"
      } m`
    );
  }
  return lines;
}

const dbPath = process.env.HMR_DB_PATH ?? path.join(process.cwd(), "data", "hmr.db");
const db = new Database(dbPath, { readonly: true });
const row = db
  .prepare("SELECT coords_json, length_km, point_count FROM tracks WHERE id = 'hmr-2026'")
  .get() as
  | { coords_json: string; length_km: number; point_count: number }
  | undefined;
if (!row) {
  console.error("[inspect] track hmr-2026 non trovata in", dbPath);
  process.exit(1);
}

const coords = JSON.parse(row.coords_json) as StoredCoord[];
const positions: Position[] = coords.map((c) =>
  c[2] != null ? [c[0], c[1], c[2]] : [c[0], c[1]]
);
// Usiamo il cum stoccato nel DB: è già calibrato sulla traccia grezza (921.3 km),
// altrimenti recalcolerebbe sulla semplificata e perderemmo di nuovo 9 km.
const cum: number[] = coords.map((c) => c[3]);

console.log(
  `[inspect] track: ${coords.length} vertici · ${row.length_km.toFixed(1)} km totali ` +
    `(manuale dichiara 922 km → shift ${(922 - row.length_km).toFixed(1)} km)\n`
);

// --- 1. Checkpoint: confronto manuale vs GPX
console.log("=== Checkpoint: km dichiarato nel manuale vs proiezione lat/lng sul GPX ===");
console.log(
  "   label                          manuale    GPX-proj    Δ km   dist proj (m)"
);
for (const cp of STATIC_CHECKPOINTS) {
  const n = nearestPointOnPolyline(positions, [cp.lng, cp.lat], cum);
  if (!n) continue;
  const delta = n.alongKm - cp.along_km;
  console.log(
    `   ${cp.name.padEnd(28)}  ${cp.along_km.toString().padStart(6)}    ` +
      `${n.alongKm.toFixed(1).padStart(7)}   ${(delta >= 0 ? "+" : "") + delta.toFixed(1).padStart(5)}   ` +
      `${(n.distKm * 1000).toFixed(0).padStart(8)}`
  );
}
console.log("");

// --- 2. Resupply: dove cade fisicamente al km dichiarato
console.log("=== Resupply: posizione al km dichiarato (solo indicazione) ===");
for (const r of STATIC_RESUPPLY) {
  const p = positionAtKm(positions, cum, Math.min(r.along_km, row.length_km));
  const overshoot =
    r.along_km > row.length_km ? ` ⚠ fuori traccia (manuale ${r.along_km})` : "";
  console.log(
    `   ${r.name.padEnd(22)}  km ${r.along_km.toString().padStart(4)}  → (${p[1].toFixed(4)}, ${p[0].toFixed(4)})${overshoot}`
  );
}
console.log("");

// --- 3. Notable sections: report esteso
console.log("=== Notable sections: stats sul range attuale + scan esteso ===\n");
for (const s of STATIC_SECTIONS) {
  const cur = sliceStats(coords, s.km_start, s.km_end);
  const shape =
    cur.elevStart == null || cur.elevEnd == null
      ? "?"
      : Math.abs(cur.elevEnd - cur.elevStart) < 30
      ? "flat"
      : cur.elevEnd > cur.elevStart
      ? "UP"
      : "DOWN";
  console.log(`[${s.severity.toUpperCase().padEnd(4)}] ${s.label}`);
  console.log(
    `   range attuale: km ${s.km_start}–${s.km_end}  (shape: ${shape})`
  );
  console.log(
    `     elev ${cur.elevStart?.toFixed(0)} → ${cur.elevEnd?.toFixed(0)} m ` +
      `· min ${cur.minElev.toFixed(0)} @ km ${cur.kmMin.toFixed(1)} · max ${cur.maxElev.toFixed(0)} @ km ${cur.kmMax.toFixed(1)}`
  );
  console.log(
    `     D+ ${cur.gain} m · D- ${cur.loss} m · pend. max +${cur.maxUpGrade}% / ${cur.maxDownGrade}% (finestra 300 m)`
  );
  console.log(`     descrizione manuale: ${s.description}`);

  const padStart = Math.max(0, s.km_start - 8);
  const padEnd = Math.min(row.length_km, s.km_end + 8);
  const step = padEnd - padStart > 30 ? 4 : 2;
  console.log(
    `   scan elev km ${padStart.toFixed(0)}→${padEnd.toFixed(0)} (ogni ${step} km):`
  );
  for (const line of scanElev(coords, padStart, padEnd, step)) {
    console.log(line);
  }
  console.log("");
}

// --- 4. Profilo completo per riferimento (ogni 10 km)
console.log("=== Profilo completo (step 10 km) ===");
for (let km = 0; km <= row.length_km; km += 10) {
  const i = findIdxAtKm(coords, km);
  const e = coords[i][2];
  const bar = e != null ? "█".repeat(Math.round(e / 120)) : "";
  console.log(
    `  km ${km.toFixed(0).padStart(3)}  ${
      e != null ? e.toFixed(0).padStart(4) : "   ?"
    } m  ${bar}`
  );
}
