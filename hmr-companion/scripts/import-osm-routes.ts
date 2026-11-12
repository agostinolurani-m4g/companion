/**
 * Importa itinerari segnati da OpenStreetMap (relazioni route=hiking|foot|bicycle|mtb)
 * come percorsi pubblici: sentieri CAI/escursionistici, ciclovie, itinerari MTB.
 *
 *   npm run import:osm-routes
 *   OSM_ROUTES_BBOX="45.75,8.75,46.65,10.45" OSM_ROUTES_TILE=0.3 npm run import:osm-routes
 *
 * Dati © OpenStreetMap contributors (ODbL). Idempotente: salta le relazioni già importate.
 * Per ogni relazione salva anche i fatti delle way membro (sac_scale, fondo, tratti attrezzati),
 * un punteggio di qualità e i fatti derivati (forma, quote dal DEM). Per i percorsi già importati
 * usare `npm run enrich:osm-routes` e `npm run backfill:route-derived`.
 */
import crypto from "node:crypto";
import { fetchOverpassRawElements } from "../src/lib/overpass";
import { getUserRouteByExternal, insertUserRoute, type UserRouteActivity } from "../src/lib/db";
import { gainLossWithHysteresis, lineLengthM, stitchWays } from "../src/lib/route-stitch";
import { simplifyToMaxPoints } from "../src/lib/line-simplify";
import { aggregateWayFacts, overpassGeomLengthM, routeQuality, type WayInfo } from "../src/lib/osm-way-facts";
import { buildDerivedFacts } from "../src/lib/route-shape";
import { elevationsNode, resampleLine } from "./lib/dem-node";

type Pt = [number, number];
type Member = { type: string; ref?: number; role?: string; geometry?: ({ lat: number; lon: number } | null)[] };
type Rel = { type: "relation"; id: number; tags?: Record<string, string>; members?: Member[] };
type WayTags = { type: "way"; id: number; tags?: Record<string, string> };

const [S, W, N, E] = (process.env.OSM_ROUTES_BBOX ?? "45.75,8.75,46.65,10.45").split(",").map(Number);
const TILE = Number(process.env.OSM_ROUTES_TILE ?? "0.3");
const MAX_KM = Number(process.env.OSM_ROUTES_MAX_KM ?? "250");
const MIN_KM = 0.8;

const ACTIVITY: Record<string, UserRouteActivity> = {
  hiking: "hike",
  foot: "walk",
  bicycle: "road",
  mtb: "mtb",
};

const NETWORK_LABEL: Record<string, string> = {
  iwn: "Internazionale",
  nwn: "Nazionale",
  rwn: "Regionale",
  lwn: "Locale",
  icn: "EuroVelo",
  ncn: "Ciclovia nazionale",
  rcn: "Ciclovia regionale",
  lcn: "Ciclovia locale",
};

function routeName(t: Record<string, string>): string | null {
  const name = t["name:it"] ?? t.name;
  if (name?.trim()) return name.trim();
  const ref = t.ref?.trim();
  if (!ref) return null;
  const from = t.from?.trim();
  const to = t.to?.trim();
  const prefix = t.route === "bicycle" || t.route === "mtb" ? "Itinerario" : t.operator?.match(/CAI/i) ? "Sentiero CAI" : "Sentiero";
  return from && to ? `${prefix} ${ref} · ${from} – ${to}` : `${prefix} ${ref}`;
}

function tiles(): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let s = S; s < N - 1e-9; s += TILE) {
    for (let w = W; w < E - 1e-9; w += TILE) {
      out.push([s, w, Math.min(N, s + TILE), Math.min(E, w + TILE)]);
    }
  }
  return out;
}

async function main() {
  const seen = new Set<number>();
  const wayTags = new Map<number, Record<string, string>>();
  let imported = 0;
  let skipped = 0;
  const all = tiles();
  console.log(`Area ${S},${W} → ${N},${E} · ${all.length} celle`);

  for (const [ti, [s, w, n, e]] of all.entries()) {
    const q = `[out:json][timeout:180];
relation["type"="route"]["route"~"^(hiking|foot|bicycle|mtb)$"](${s},${w},${n},${e})->.r;
.r out geom;
way(r.r);
out tags;`;
    let els: unknown[] = [];
    try {
      els = await fetchOverpassRawElements(q);
    } catch (err) {
      console.warn(`cella ${ti + 1}/${all.length} fallita:`, err instanceof Error ? err.message : err);
      continue;
    }
    const rels = els.filter((x): x is Rel => (x as Rel).type === "relation");
    wayTags.clear();
    for (const x of els as WayTags[]) if (x.type === "way" && x.tags) wayTags.set(x.id, x.tags);
    console.log(`cella ${ti + 1}/${all.length}: ${rels.length} relazioni`);

    for (const rel of rels) {
      try {
        await importRelation(rel);
      } catch (err) {
        skipped++;
        console.warn(`relazione ${rel.id} saltata:`, err instanceof Error ? err.message : err);
      }
    }
  }
  console.log(`Fatto: importati=${imported} saltati=${skipped} relazioni viste=${seen.size}`);

  async function importRelation(rel: Rel): Promise<void> {
    {
      if (seen.has(rel.id)) return;
      seen.add(rel.id);
      const t = rel.tags ?? {};
      const ext = `relation/${rel.id}`;
      if (getUserRouteByExternal("osm", ext)) {
        skipped++;
        return;
      }
      const activity = ACTIVITY[t.route ?? ""];
      const name = routeName(t);
      if (!activity || !name || t.state === "proposed" || t.disused === "yes") {
        skipped++;
        return;
      }
      const ways: Pt[][] = (rel.members ?? [])
        .filter((m) => m.type === "way" && m.geometry && m.geometry.length >= 2 && !/^(platform|stop)/.test(m.role ?? ""))
        .map((m) => m.geometry!.filter((g): g is { lat: number; lon: number } => !!g && Number.isFinite(g.lon)).map((g) => [g.lon, g.lat] as Pt))
        .filter((w) => w.length >= 2);
      const st = stitchWays(ways);
      if (!st) {
        skipped++;
        return;
      }
      const km = lineLengthM(st.line) / 1000;
      // Relazioni frammentate (catena principale < 60% del totale) o fuori scala: scarta.
      if (km < MIN_KM || km > MAX_KM || st.coverage < 0.6) {
        skipped++;
        return;
      }

      let gain = 0;
      let loss = 0;
      const samples = resampleLine(st.line, 60);
      const elev = await elevationsNode(samples);
      if (elev) ({ gain, loss } = gainLossWithHysteresis(elev, 6));

      const line = simplifyToMaxPoints(st.line, 4000) as Pt[];
      const wayInfos: WayInfo[] = (rel.members ?? [])
        .filter((m) => m.type === "way" && m.ref != null)
        .map((m) => ({ lengthM: overpassGeomLengthM(m.geometry), tags: wayTags.get(m.ref!) ?? {} }));
      const coverage = Math.round(st.coverage * 100) / 100;
      const now = Date.now();
      insertUserRoute({
        id: crypto.randomUUID(),
        owner: "osm",
        name,
        activity,
        geojson: JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } }),
        waypoints_json: "[]",
        length_km: Math.round(km * 100) / 100,
        elev_gain_m: gain,
        elev_loss_m: loss,
        visibility: "public",
        source: "osm",
        source_url: `https://www.openstreetmap.org/relation/${rel.id}`,
        license: "ODbL © OpenStreetMap contributors",
        external_id: ext,
        meta_json: JSON.stringify({
          route: t.route,
          network: t.network ?? null,
          network_label: NETWORK_LABEL[t.network ?? ""] ?? null,
          ref: t.ref ?? null,
          operator: t.operator ?? null,
          from: t.from ?? null,
          to: t.to ?? null,
          symbol: t["osmc:symbol"] ?? null,
          sac_scale: t.sac_scale ?? null,
          description: t.description ?? t["description:it"] ?? null,
          stitched_chains: st.chains,
          coverage,
          way_facts: aggregateWayFacts(wayInfos),
          quality: routeQuality({ length_km: km, coverage, chains: st.chains, hasName: !!t.name, hasRef: !!t.ref }),
          derived: buildDerivedFacts(st.line, elev),
        }),
        created_at: now,
        updated_at: now,
      });
      imported++;
      if (imported % 25 === 0) console.log(`  … ${imported} importati`);
    }
  }
}

void main();
