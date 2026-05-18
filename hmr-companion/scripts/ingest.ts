/**
 * Ingest one-shot: parse GPX → semplifica → calcola cumulato km + elev →
 * salva in `tracks` + seed checkpoints / official_resupply / notable_sections.
 *
 * Usage:
 *   npm run ingest
 *   HMR_GPX_FILENAME=Other.gpx npm run ingest
 */

import fs from "node:fs";
import path from "node:path";
import type { Position } from "geojson";
import { v4 as uuidv4 } from "uuid";
import { getDb, getDbPath } from "../src/lib/db";
import { parseGpxTrackpoints } from "../src/lib/gpx";
import { simplifyLineStringWithIndices } from "../src/lib/line-simplify";
import {
  cumulativeKmAlong,
  ELEV_GAIN_DEFAULT_THRESHOLD_M,
  ELEV_GAIN_DEFAULT_WINDOW_PTS,
  elevationGainLossSmoothed,
  nearestPointOnPolyline,
  positionAtKm,
} from "../src/lib/track-geometry";
import type { StoredCoord } from "../src/lib/track-coords";
import { measureBetween } from "../src/lib/track-measure";
import {
  STATIC_BRIDGES,
  STATIC_CHECKPOINTS,
  STATIC_RESUPPLY,
  STATIC_SECTIONS,
} from "../src/lib/seed-static";

/** Rapporto D+ ufficiale (GPX grezzo ITRA) / D+ misurato sulla stessa polyline salvata in DB. */
function profileElevScale(official: number, measured: number): number {
  if (measured <= 0.5 || official <= 0) return 1;
  const r = official / measured;
  return Number.isFinite(r) && r > 0 ? r : 1;
}

const TRACK_ID = "hmr-2026";
const TRACK_NAME = "Hellenic Mountain Race 2026";
const SIMPLIFY_EPS_DEG = 0.00005; // ≈5 m a lat medie
function main() {
  const fileName = process.env.HMR_GPX_FILENAME?.trim() || "Hellenic_Mountain_Race_2026.gpx";
  const gpxPath = path.join(process.cwd(), "data", fileName);
  if (!fs.existsSync(gpxPath)) {
    console.error(`[ingest] GPX non trovato: ${gpxPath}`);
    process.exit(1);
  }

  console.log(`[ingest] Lettura GPX: ${gpxPath}`);
  const xml = fs.readFileSync(gpxPath, "utf8");
  const pts = parseGpxTrackpoints(xml);
  if (pts.length < 2) {
    console.error(`[ingest] GPX vuoto o malformato`);
    process.exit(1);
  }
  console.log(`[ingest] Trkpt grezzi: ${pts.length}`);

  const raw: Position[] = pts.map((p) => {
    const c: Position = [p.lng, p.lat];
    if (p.eleM != null && Number.isFinite(p.eleM)) c.push(p.eleM);
    return c;
  });

  const rawElevations = pts.map((p) =>
    p.eleM != null && Number.isFinite(p.eleM) ? p.eleM : null
  );
  const { gain, loss } = elevationGainLossSmoothed(rawElevations, {
    windowPts: ELEV_GAIN_DEFAULT_WINDOW_PTS,
    thresholdM: ELEV_GAIN_DEFAULT_THRESHOLD_M,
  });

  // Cumulato km calcolato sulla traccia GREZZA: è l'unico modo per avere
  // `length_km` e i `cum_km` dei vertici allineati al valore reale del GPX
  // (es. Komoot). Dopo DP la geometria è più compatta ma i `cumKm` dei vertici
  // tenuti provengono dal rawCum → zero perdita di lunghezza per semplificazione.
  const rawCum = cumulativeKmAlong(raw);
  const rawTotalKm = rawCum[rawCum.length - 1];

  const { coords: simplified, indices: keptIdx } = simplifyLineStringWithIndices(
    raw,
    SIMPLIFY_EPS_DEG
  );
  console.log(
    `[ingest] Dopo DP (eps=${SIMPLIFY_EPS_DEG}): ${simplified.length} vertici (−${(
      ((raw.length - simplified.length) / raw.length) *
      100
    ).toFixed(1)}%)`
  );

  // cum aligned a simplified: prende il km cumulato del vertice grezzo corrispondente
  const cum: number[] = keptIdx.map((i) => rawCum[i]);
  const totalKm = rawTotalKm;

  const simplifiedLen = cumulativeKmAlong(simplified);
  const simplifiedTotalKm = simplifiedLen[simplifiedLen.length - 1];
  console.log(
    `[ingest] Lunghezza: raw ${rawTotalKm.toFixed(3)} km · ` +
      `simplified ${simplifiedTotalKm.toFixed(3)} km (recupero ${(rawTotalKm - simplifiedTotalKm).toFixed(3)} km via rawCum)`
  );

  const lngs = simplified.map((c) => c[0]);
  const lats = simplified.map((c) => c[1]);
  const bbox = {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };

  const coordsJson: [number, number, number | null, number][] = simplified.map((c, i) => [
    Number(c[0].toFixed(6)),
    Number(c[1].toFixed(6)),
    typeof c[2] === "number" ? Math.round(c[2]) : null,
    Number(cum[i].toFixed(3)),
  ]);

  console.log(
    `[ingest] Totale: ${totalKm.toFixed(1)} km · D+ ${Math.round(gain)} m · D- ${Math.round(loss)} m ` +
      `(smoothing ITRA MA=${ELEV_GAIN_DEFAULT_WINDOW_PTS}pts hyst=${ELEV_GAIN_DEFAULT_THRESHOLD_M}m su ${pts.length} trkpt raw)`
  );

  const storedCoords = coordsJson as unknown as StoredCoord[];
  const hiStored = storedCoords[storedCoords.length - 1][3];
  const profileRef = measureBetween(storedCoords, 0, hiStored);
  const elevProfileGainScale = profileElevScale(gain, profileRef.gainM);
  const elevProfileLossScale = profileElevScale(loss, profileRef.lossM);
  console.log(
    `[ingest] Scala profilo (vertici vs GPX): D+ ×${elevProfileGainScale.toFixed(3)} · D- ×${elevProfileLossScale.toFixed(3)} ` +
      `(su intera gara: profilo ${Math.round(profileRef.gainM)} m D+ vs ${Math.round(gain)} m ufficiale)`
  );

  const db = getDb();
  const dbPath = getDbPath();
  console.log(`[ingest] DB path: ${dbPath}`);

  const existingTrack = db.prepare(`SELECT id, created_at FROM tracks WHERE id = ?`).get(TRACK_ID) as
    | { id: string; created_at: number }
    | undefined;
  const poiCountBefore = (
    db.prepare(`SELECT COUNT(*) AS n FROM pois WHERE track_id = ?`).get(TRACK_ID) as { n: number }
  ).n;

  const tx = db.transaction(() => {
    const now = Date.now();
    const createdAt = existingTrack?.created_at ?? now;
    if (existingTrack) {
      db.prepare(
        `UPDATE tracks SET
           name = ?, gpx_path = ?, coords_json = ?, length_km = ?, elev_gain_m = ?, elev_loss_m = ?,
           elev_profile_gain_scale = ?, elev_profile_loss_scale = ?, bbox_json = ?, point_count = ?
         WHERE id = ?`
      ).run(
        TRACK_NAME,
        `data/${fileName}`,
        JSON.stringify(coordsJson),
        Number(totalKm.toFixed(3)),
        Math.round(gain),
        Math.round(loss),
        elevProfileGainScale,
        elevProfileLossScale,
        JSON.stringify(bbox),
        simplified.length,
        TRACK_ID
      );
    } else {
      db.prepare(
        `INSERT INTO tracks (id, name, gpx_path, coords_json, length_km, elev_gain_m, elev_loss_m, elev_profile_gain_scale, elev_profile_loss_scale, bbox_json, point_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        TRACK_ID,
        TRACK_NAME,
        `data/${fileName}`,
        JSON.stringify(coordsJson),
        Number(totalKm.toFixed(3)),
        Math.round(gain),
        Math.round(loss),
        elevProfileGainScale,
        elevProfileLossScale,
        JSON.stringify(bbox),
        simplified.length,
        createdAt
      );
    }

    db.prepare(`DELETE FROM checkpoints WHERE track_id = ?`).run(TRACK_ID);
    const insCp = db.prepare(
      `INSERT INTO checkpoints (id, track_id, name, kind, label, lat, lng, along_km, cutoff_utc, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const cp of STATIC_CHECKPOINTS) {
      // Priorità al km dichiarato dal manuale: le coordinate lat/lng del seed
      // sono un fallback/sanity-check, ma il km ufficiale è l'ancoraggio
      // autoritativo (es. CP1 Smolikas: il km 247 del manuale cade a km 237.6
      // sulla proiezione lat/lng; diamo fiducia al manuale).
      const projectedByKm = positionAtKm(simplified, cum, cp.along_km);
      const nearest = nearestPointOnPolyline(simplified, [cp.lng, cp.lat], cum);
      const sanityDelta =
        nearest && Number.isFinite(nearest.alongKm)
          ? Math.abs(nearest.alongKm - cp.along_km)
          : null;
      if (sanityDelta != null && sanityDelta > 5) {
        console.warn(
          `[ingest] ⚠ CP ${cp.name}: lat/lng del seed proietta a km ${nearest!.alongKm.toFixed(1)}, ` +
            `ma il manuale dichiara km ${cp.along_km} (Δ ${sanityDelta.toFixed(1)} km). ` +
            `Uso il km dichiarato — verifica le coord se il marker risulta fuori posto.`
        );
      }
      const lat = projectedByKm[1];
      const lng = projectedByKm[0];
      const alongKm = cp.along_km;
      insCp.run(
        cp.id,
        TRACK_ID,
        cp.name,
        cp.kind,
        cp.label,
        Number(lat.toFixed(6)),
        Number(lng.toFixed(6)),
        Number(alongKm.toFixed(3)),
        cp.cutoff_utc,
        cp.notes
      );
    }

    db.prepare(`DELETE FROM official_resupply WHERE track_id = ?`).run(TRACK_ID);
    const insRs = db.prepare(
      `INSERT INTO official_resupply (id, track_id, name, along_km, leg_km, lat, lng, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of STATIC_RESUPPLY) {
      let alongKm = r.along_km;
      let lat: number;
      let lng: number;
      if (r.lat != null && r.lng != null) {
        const nearest = nearestPointOnPolyline(simplified, [r.lng, r.lat], cum);
        if (nearest) {
          alongKm = nearest.alongKm;
          lng = nearest.closest[0];
          lat = nearest.closest[1];
        } else {
          const pos = positionAtKm(simplified, cum, r.along_km);
          lat = pos[1];
          lng = pos[0];
        }
      } else {
        const pos = positionAtKm(simplified, cum, r.along_km);
        lat = pos[1];
        lng = pos[0];
      }
      insRs.run(
        r.id,
        TRACK_ID,
        r.name,
        Number(alongKm.toFixed(3)),
        r.leg_km,
        Number(lat.toFixed(6)),
        Number(lng.toFixed(6)),
        r.notes
      );
    }

    db.prepare(`DELETE FROM course_bridges WHERE track_id = ?`).run(TRACK_ID);
    const insBr = db.prepare(
      `INSERT INTO course_bridges (id, track_id, name, lat, lng, along_km, description_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const b of STATIC_BRIDGES) {
      const nearest = nearestPointOnPolyline(simplified, [b.lng, b.lat], cum);
      const lat = nearest ? nearest.closest[1] : b.lat;
      const lng = nearest ? nearest.closest[0] : b.lng;
      const alongKm = nearest?.alongKm ?? 0;
      insBr.run(
        b.id,
        TRACK_ID,
        b.name,
        Number(lat.toFixed(6)),
        Number(lng.toFixed(6)),
        Number(alongKm.toFixed(3)),
        b.description_en
      );
    }

    db.prepare(`DELETE FROM notable_sections WHERE track_id = ?`).run(TRACK_ID);
    const insSec = db.prepare(
      `INSERT INTO notable_sections (id, track_id, label, km_start, km_end, severity, description, description_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of STATIC_SECTIONS) {
      insSec.run(s.id, TRACK_ID, s.label, s.km_start, s.km_end, s.severity, s.description, s.description_en);
    }
  });

  tx();

  const poiCountAfter = (
    db.prepare(`SELECT COUNT(*) AS n FROM pois WHERE track_id = ?`).get(TRACK_ID) as { n: number }
  ).n;

  console.log(`[ingest] OK · track id=${TRACK_ID}`);
  console.log(
    `[ingest] ${STATIC_CHECKPOINTS.length} checkpoints / ${STATIC_RESUPPLY.length} resupply / ${STATIC_SECTIONS.length} sections / ${STATIC_BRIDGES.length} bridges`
  );
  console.log(
    `[ingest] POI in DB: ${poiCountAfter} (prima ${poiCountBefore}) — ingest non cancella POI/piani custom.`
  );
  if (poiCountAfter === 0) {
    console.log(`[ingest] Nessun POI: esegui \`npm run snapshot\` per scaricare Overpass (~10–20 min).`);
  }
  console.log(`[ingest] Opzionale: \`npm run snapshot:surface\` per asfalto/sterrato/single (OSM).`);
  console.log(`[ingest] (uuid helper preload: ${uuidv4().slice(0, 4)}…) — dependency ok`);
}

main();
