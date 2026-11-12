/**
 * Logica condivisa degli import camptocamp (scialpinismo e altre attività).
 * Idempotente: salta i documenti già presenti (source + external_id).
 */
import crypto from "node:crypto";
import {
  ALPS_IMPORT_BBOXES,
  C2C_ACTIVITY_MAP,
  getRoute,
  pickLocaleTitle,
  routeLineWgs84,
  searchRoutes,
  type C2cActivity,
  type C2cRouteDetail,
} from "../../src/lib/camptocamp";
import { buildC2cMeta } from "../../src/lib/camptocamp-meta";
import { getUserRouteByExternal, insertUserRoute, type UserRouteActivity } from "../../src/lib/db";
import { lineLengthKm } from "../../src/lib/osrm-route";
import { gainLossWithHysteresis } from "../../src/lib/route-stitch";
import { buildSkiGeoJson } from "../../src/lib/ski-overlays";
import { elevationsNode, resampleLine } from "./dem-node";

export const C2C_SOURCE = "camptocamp";
export const C2C_LICENSE = "CC-BY-SA 4.0";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function appActivityForC2c(act: C2cActivity): UserRouteActivity {
  return act === "skitouring" ? "ski" : C2C_ACTIVITY_MAP[act];
}

export type C2cImportOptions = {
  /** Massimo di nuovi percorsi importati per questa attività. */
  max: number;
  /** Pausa tra richieste (ms). */
  pauseMs: number;
  verbose?: boolean;
};

export type C2cImportStats = { imported: number; skipped: number; scanned: number };

/** Costruisce la riga `user_routes` da un dettaglio camptocamp; null se la geometria non è utilizzabile. */
async function buildRow(detail: C2cRouteDetail, act: C2cActivity) {
  const coords = routeLineWgs84(detail);
  if (!coords || coords.length < 2) return null;
  const length_km = lineLengthKm(coords);
  const ski = act === "skitouring";
  if (!ski && (length_km < 0.3 || length_km > 120)) return null;
  let gain = Number(detail.height_diff_up ?? 0);
  let loss = Number(detail.height_diff_down ?? 0);
  if (!ski && !gain && !loss) {
    const elev = await elevationsNode(resampleLine(coords, 60));
    if (elev) ({ gain, loss } = gainLossWithHysteresis(elev, 6));
  }
  const geojson = ski
    ? buildSkiGeoJson(coords, null)
    : { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
  return {
    name: pickLocaleTitle(detail.locales),
    geojson: JSON.stringify(geojson),
    waypoints_json: ski ? JSON.stringify({ ascent: [], descent: [] }) : "[]",
    length_km,
    elev_gain_m: gain,
    elev_loss_m: loss,
    // Forma (route_types) e quote min/max arrivano dalla fonte: niente `derived` geometrico.
    meta_json: JSON.stringify(buildC2cMeta(detail, act)),
  };
}

export async function importC2cActivity(act: C2cActivity, opts: C2cImportOptions): Promise<C2cImportStats> {
  const activity = appActivityForC2c(act);
  const stats: C2cImportStats = { imported: 0, skipped: 0, scanned: 0 };
  const seen = new Set<number>();
  for (const bbox of ALPS_IMPORT_BBOXES) {
    let offset = 0;
    while (stats.imported < opts.max) {
      let page;
      try {
        page = await searchRoutes(act, bbox, { limit: 100, offset });
      } catch (e) {
        console.warn(`${act} offset ${offset}:`, e instanceof Error ? e.message : e);
        break;
      }
      if (page.documents.length === 0) break;
      for (const doc of page.documents) {
        if (stats.imported >= opts.max) break;
        const id = doc.document_id;
        if (seen.has(id)) continue;
        seen.add(id);
        stats.scanned++;
        const ext = String(id);
        if (getUserRouteByExternal(C2C_SOURCE, ext) || !doc.geometry?.has_geom_detail) {
          stats.skipped++;
          continue;
        }
        await sleep(opts.pauseMs);
        let detail: C2cRouteDetail;
        try {
          detail = await getRoute(id);
        } catch (e) {
          if (opts.verbose) console.warn(`Skip ${id}:`, e instanceof Error ? e.message : e);
          stats.skipped++;
          continue;
        }
        const row = await buildRow(detail, act);
        if (!row) {
          stats.skipped++;
          continue;
        }
        const now = Date.now();
        insertUserRoute({
          id: crypto.randomUUID(),
          owner: C2C_SOURCE,
          activity,
          ...row,
          visibility: "public",
          source: C2C_SOURCE,
          source_url: `https://www.camptocamp.org/routes/${id}`,
          license: C2C_LICENSE,
          external_id: ext,
          created_at: now,
          updated_at: now,
        });
        stats.imported++;
        if (opts.verbose) console.log(`+ ${row.name} (${row.length_km.toFixed(1)} km)`);
      }
      offset += 100;
      if (offset >= page.total) break;
      await sleep(opts.pauseMs);
    }
  }
  return stats;
}

/** Legge un limite intero ≥ 0 da env («all» = nessun limite; valore assente o non valido → fallback). */
export function envLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (raw.toLowerCase() === "all") return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
