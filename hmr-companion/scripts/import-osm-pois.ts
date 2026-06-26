/**
 * Import POI OSM da file .osm.pbf (es. italy-latest.osm.pbf) in SQLite locale.
 *
 * Uso:
 *   npm run osm:import -- data/osm/italy-latest.osm.pbf
 *
 * Due passaggi sul file: (1) way POI + node refs, (2) node POI + centroidi way.
 */
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import parseOSM from "osm-pbf-parser";
import {
  countLocalPoisByCategory,
  insertLocalOsmPoiBatch,
  localPoiCount,
  resetLocalOsmStore,
  setLocalOsmCoverage,
  type PoiCategory,
} from "../src/lib/db";
import { classifyOsm } from "../src/lib/overpass";

/** Bbox approssimativa Italia (Geofabrik extract). */
const ITALY_COVERAGE = {
  region: "italy",
  south: 35.4,
  west: 6.6,
  north: 47.1,
  east: 18.6,
} as const;

const BATCH_SIZE = 5000;

type PbfItem = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  refs?: number[];
};

type PoiInsert = {
  osm_type: string;
  osm_id: number;
  category: PoiCategory;
  sub_kind: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
};

type PoiWay = {
  tags: Record<string, string>;
  refs: number[];
};

async function* iterateOsmPbf(filePath: string): AsyncGenerator<PbfItem> {
  const parser = parseOSM();
  const stream = fs.createReadStream(filePath).pipe(parser).pipe(
    new Transform({
      objectMode: true,
      transform(items: unknown[], _enc, next) {
        for (const item of items) this.push(item);
        next();
      },
    })
  );

  for await (const item of stream) {
    yield item as PbfItem;
  }
}

function resolvePbfPath(): string {
  const arg = process.argv[2]?.trim();
  if (!arg) {
    console.error("Uso: npm run osm:import -- <path-to.osm.pbf>");
    console.error("Es.: npm run osm:import -- data/osm/italy-latest.osm.pbf");
    process.exit(1);
  }
  const resolved = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
  if (!fs.existsSync(resolved)) {
    console.error(`[osm:import] File non trovato: ${resolved}`);
    process.exit(1);
  }
  return resolved;
}

async function pass1CollectWays(
  filePath: string
): Promise<{ poiWays: Map<number, PoiWay>; neededNodeIds: Set<number> }> {
  const poiWays = new Map<number, PoiWay>();
  const neededNodeIds = new Set<number>();
  let ways = 0;
  let poiWayCount = 0;

  for await (const item of iterateOsmPbf(filePath)) {
    if (item.type !== "way") continue;
    ways++;
    const tags = item.tags ?? {};
    if (!classifyOsm(tags)) continue;
    const refs = item.refs ?? [];
    if (refs.length === 0) continue;
    poiWays.set(item.id, { tags, refs });
    poiWayCount++;
    for (const ref of refs) neededNodeIds.add(ref);
    if (ways % 500_000 === 0) {
      console.log(`[osm:import] pass1: ${ways.toLocaleString()} way scansionate, ${poiWayCount.toLocaleString()} POI way`);
    }
  }

  console.log(
    `[osm:import] pass1 completato: ${ways.toLocaleString()} way, ${poiWayCount.toLocaleString()} POI way, ${neededNodeIds.size.toLocaleString()} node refs`
  );
  return { poiWays, neededNodeIds };
}

async function pass2ImportNodesAndWays(
  filePath: string,
  poiWays: Map<number, PoiWay>,
  neededNodeIds: Set<number>
): Promise<void> {
  const nodeCoords = new Map<number, { lat: number; lng: number }>();
  let batch: PoiInsert[] = [];
  let nodes = 0;
  let poiNodes = 0;

  const flush = () => {
    if (batch.length === 0) return;
    insertLocalOsmPoiBatch(batch);
    batch = [];
  };

  for await (const item of iterateOsmPbf(filePath)) {
    if (item.type !== "node") continue;
    nodes++;
    const lat = item.lat;
    const lon = item.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;

    if (neededNodeIds.has(item.id)) {
      nodeCoords.set(item.id, { lat, lng: lon });
    }

    const tags = item.tags ?? {};
    const klass = classifyOsm(tags);
    if (klass) {
      batch.push({
        osm_type: "node",
        osm_id: item.id,
        category: klass.category,
        sub_kind: klass.sub_kind,
        lat,
        lng: lon,
        tags,
      });
      poiNodes++;
      if (batch.length >= BATCH_SIZE) flush();
    }

    if (nodes % 1_000_000 === 0) {
      console.log(`[osm:import] pass2: ${nodes.toLocaleString()} node, ${poiNodes.toLocaleString()} POI node`);
      flush();
    }
  }

  flush();
  console.log(`[osm:import] pass2 node: ${nodes.toLocaleString()} totali, ${poiNodes.toLocaleString()} POI node`);

  let poiWayInserted = 0;
  let poiWaySkipped = 0;
  for (const [wayId, { tags, refs }] of poiWays) {
    const klass = classifyOsm(tags);
    if (!klass) continue;
    let sumLat = 0;
    let sumLng = 0;
    let n = 0;
    for (const ref of refs) {
      const c = nodeCoords.get(ref);
      if (!c) continue;
      sumLat += c.lat;
      sumLng += c.lng;
      n++;
    }
    if (n === 0) {
      poiWaySkipped++;
      continue;
    }
    batch.push({
      osm_type: "way",
      osm_id: wayId,
      category: klass.category,
      sub_kind: klass.sub_kind,
      lat: sumLat / n,
      lng: sumLng / n,
      tags,
    });
    poiWayInserted++;
    if (batch.length >= BATCH_SIZE) flush();
  }
  flush();

  console.log(
    `[osm:import] pass2 way: ${poiWayInserted.toLocaleString()} centroidi inseriti, ${poiWaySkipped.toLocaleString()} senza coordinate`
  );
}

async function main() {
  const filePath = resolvePbfPath();
  const stat = fs.statSync(filePath);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(1);
  console.log(`[osm:import] File: ${filePath} (${sizeMb} MB)`);

  const t0 = Date.now();
  resetLocalOsmStore();
  console.log("[osm:import] Store locale svuotato");

  const { poiWays, neededNodeIds } = await pass1CollectWays(filePath);
  await pass2ImportNodesAndWays(filePath, poiWays, neededNodeIds);

  setLocalOsmCoverage({
    ...ITALY_COVERAGE,
    imported_at: Math.floor(Date.now() / 1000),
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const total = localPoiCount();
  console.log(`[osm:import] Completato in ${elapsed}s — ${total.toLocaleString()} POI totali`);
  console.log("[osm:import] Per categoria:");
  for (const row of countLocalPoisByCategory()) {
    console.log(`  ${row.category}: ${row.n.toLocaleString()}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
