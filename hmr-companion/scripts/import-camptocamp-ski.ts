/**
 * Import gite scialpinismo da camptocamp.org nel DB locale.
 * npm run import:c2c
 */
import crypto from "node:crypto";
import {
  ALPS_IMPORT_BBOXES,
  getRoute,
  pickLocaleTitle,
  routeLineWgs84,
  searchSkiRoutes,
} from "../src/lib/camptocamp";
import { getUserRouteByExternal, insertUserRoute } from "../src/lib/db";
import { buildSkiGeoJson } from "../src/lib/ski-overlays";
import { lineLengthKm } from "../src/lib/osrm-route";

const OWNER = "camptocamp";
const LICENSE = "CC-BY-SA 4.0";
const SOURCE = "camptocamp";
const PAUSE_MS = 400;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const seen = new Set<number>();
  let imported = 0;
  let skipped = 0;

  for (const bbox of ALPS_IMPORT_BBOXES) {
    let offset = 0;
    const limit = 100;
    while (true) {
      const { documents, total } = await searchSkiRoutes(bbox, { limit, offset });
      if (documents.length === 0) break;

      for (const doc of documents) {
        const id = doc.document_id;
        if (seen.has(id)) continue;
        seen.add(id);

        const extKey = String(id);
        if (getUserRouteByExternal(SOURCE, extKey)) {
          skipped++;
          continue;
        }

        if (!doc.geometry?.has_geom_detail) {
          skipped++;
          continue;
        }

        await sleep(PAUSE_MS);
        let detail;
        try {
          detail = await getRoute(id);
        } catch (e) {
          console.warn(`Skip ${id}:`, e);
          skipped++;
          continue;
        }

        const coords = routeLineWgs84(detail);
        if (!coords || coords.length < 2) {
          skipped++;
          continue;
        }

        const name = pickLocaleTitle(detail.locales);
        const geojson = buildSkiGeoJson(coords, null);
        const length_km = lineLengthKm(coords);
        const meta = {
          ski_rating: detail.ski_rating,
          ski_exposition: detail.ski_exposition,
          labande_global_rating: detail.labande_global_rating,
          labande_ski_rating: detail.labande_ski_rating,
          elevation_max: detail.elevation_max,
          elevation_min: detail.elevation_min,
          height_diff_up: detail.height_diff_up,
          height_diff_down: detail.height_diff_down,
          orientations: detail.orientations,
          summary: detail.locales.find((l) => l.lang === "it" || l.lang === "fr")?.summary,
        };

        const now = Date.now();
        insertUserRoute({
          id: crypto.randomUUID(),
          owner: OWNER,
          name,
          activity: "ski",
          geojson: JSON.stringify(geojson),
          waypoints_json: JSON.stringify({ ascent: [], descent: [] }),
          length_km,
          elev_gain_m: detail.height_diff_up ?? 0,
          elev_loss_m: detail.height_diff_down ?? 0,
          visibility: "public",
          source: SOURCE,
          source_url: `https://www.camptocamp.org/routes/${id}`,
          license: LICENSE,
          external_id: extKey,
          meta_json: JSON.stringify(meta),
          created_at: now,
          updated_at: now,
        });
        imported++;
        console.log(`+ ${name} (${length_km.toFixed(1)} km)`);
      }

      offset += limit;
      if (offset >= total) break;
      await sleep(PAUSE_MS);
    }
  }

  console.log(`Done: imported=${imported} skipped=${skipped} scanned=${seen.size}`);
}

void main();
