/**
 * Import archivio outdoor da .osm.pbf (nodi, way, relazioni) limitato a una bbox.
 *
 * Uso:
 *   npm run outdoor:import -- data/osm/italy-latest.osm.pbf
 *
 * Opzioni (env oppure argomenti --nome=valore):
 *   OUTDOOR_BBOX / --bbox=west,south,east,north   default arco alpino 5.8,45.0,10.8,47.3
 *   OUTDOOR_TRAILS / --trails=all|hiking|none     default hiking (vedi src/lib/outdoor/pbf-filter.ts)
 *   OUTDOOR_EXCLUDE_KINDS / --exclude=k1,k2       kind da non importare (es. bench,atm)
 *   OUTDOOR_MARK_TILES / --mark-tiles=0|1         default 1: marca i tile z10 coperti in outdoor_tiles
 *   OUTDOOR_DRY_RUN / --dry-run                   conta e stima senza aprire né scrivere il DB
 *   HMR_DB_PATH                                    DB di destinazione (default data/hmr.db)
 *
 * Due letture del file: (A) way+relazioni candidate e nodi referenziati, (B) nodi, interrotta
 * alla prima way se il PBF è ordinato (tipo, id) come gli estratti Geofabrik.
 * Le coordinate dei nodi delle way restano in memoria (typed array), non nel DB.
 */
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import parseOSM from "osm-pbf-parser";
import type Database from "better-sqlite3";
import { simplifyLineString } from "../src/lib/line-simplify";
import { classifyOutdoor, featureDisplayName, outdoorFeatureId, parseEle } from "../src/lib/outdoor/taxonomy";
import type { UpsertOutdoorFeatureInput } from "../src/lib/outdoor/store";
import {
  coverageCellKey,
  fullyCoveredTilesZ10,
  kindAllowed,
  parseKindList,
  parseTrailMode,
} from "../src/lib/outdoor/pbf-filter";
import { bboxContains, DEFAULT_OUTDOOR_BBOX, parseBboxEnv } from "./lib/outdoor-bbox";

const BATCH = 3000;

type PbfItem = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  refs?: number[];
  members?: Array<{ type: string; ref: number; role?: string }>;
};

// ---------- opzioni ----------

function argOpt(name: string): string | undefined {
  const pfx = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pfx));
  if (hit) return hit.slice(pfx.length);
  if (process.argv.includes(`--${name}`)) return "1";
  return undefined;
}

function resolvePbfPath(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"))?.trim();
  if (!arg) {
    console.error("Uso: npm run outdoor:import -- <path-to.osm.pbf> [--bbox=w,s,e,n] [--trails=hiking] [--dry-run]");
    process.exit(1);
  }
  const resolved = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
  if (!fs.existsSync(resolved)) {
    console.error(`File non trovato: ${resolved}`);
    process.exit(1);
  }
  return resolved;
}

const opts = {
  bbox: parseBboxEnv(argOpt("bbox") ?? process.env.OUTDOOR_BBOX, DEFAULT_OUTDOOR_BBOX),
  trails: parseTrailMode(argOpt("trails") ?? process.env.OUTDOOR_TRAILS),
  exclude: parseKindList(argOpt("exclude") ?? process.env.OUTDOOR_EXCLUDE_KINDS),
  markTiles: (argOpt("mark-tiles") ?? process.env.OUTDOOR_MARK_TILES ?? "1") !== "0",
  dryRun: ["1", "true", "yes"].includes((argOpt("dry-run") ?? process.env.OUTDOOR_DRY_RUN ?? "").toLowerCase()),
};

// ---------- lettura PBF ----------

async function* iterateOsmPbf(filePath: string): AsyncGenerator<PbfItem> {
  const parser = parseOSM();
  const src = fs.createReadStream(filePath);
  const stream = src.pipe(parser).pipe(
    new Transform({
      objectMode: true,
      transform(items: unknown[], _enc, next) {
        for (const item of items) this.push(item);
        next();
      },
    }),
  );
  try {
    for await (const item of stream) yield item as PbfItem;
  } finally {
    src.destroy();
    parser.destroy();
    stream.destroy();
  }
}

/** Array di float64 crescente (id nodo < 2^53). */
class GrowF64 {
  buf = new Float64Array(1 << 20);
  len = 0;
  push(v: number) {
    if (this.len === this.buf.length) {
      const nb = new Float64Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.len++] = v;
  }
  view(): Float64Array {
    return this.buf.subarray(0, this.len);
  }
}

function sortedUnique(a: Float64Array): Float64Array {
  const s = Float64Array.from(a).sort();
  let w = 0;
  for (let i = 0; i < s.length; i++) if (i === 0 || s[i] !== s[w - 1]) s[w++] = s[i]!;
  return s.slice(0, w);
}

function indexOf(sorted: Float64Array, v: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const m = sorted[mid]!;
    if (m === v) return mid;
    if (m < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;
const heap = () => mb(process.memoryUsage().rss);

type Cand = { id: number; tagsJson: string; refStart: number; refEnd: number };

/** Passata A: way e relazioni outdoor (filtrate per tipo), con i riferimenti ai nodi. */
async function passWaysRelations(filePath: string) {
  const ways: Cand[] = [];
  const rels: Cand[] = [];
  const refs = new GrowF64();
  let nodesAfterWays = false;
  let seenWay = false;
  let scannedWays = 0;
  for await (const item of iterateOsmPbf(filePath)) {
    if (item.type === "node") {
      if (seenWay) nodesAfterWays = true;
      continue;
    }
    if (item.type === "way") {
      seenWay = true;
      scannedWays++;
      if (scannedWays % 2_000_000 === 0) {
        console.log(`[outdoor:import] A: ${scannedWays.toLocaleString()} way lette, ${ways.length.toLocaleString()} candidate, RSS ${heap()}`);
      }
      const tags = item.tags ?? {};
      const c = classifyOutdoor("way", tags);
      if (!c || !kindAllowed(c.group, c.kind, opts.trails, opts.exclude)) continue;
      const wr = item.refs ?? [];
      if (wr.length === 0) continue;
      const refStart = refs.len;
      for (const r of wr) refs.push(r);
      ways.push({ id: item.id, tagsJson: JSON.stringify(tags), refStart, refEnd: refs.len });
    } else if (item.type === "relation") {
      const tags = item.tags ?? {};
      const c = classifyOutdoor("relation", tags);
      if (!c || !kindAllowed(c.group, c.kind, opts.trails, opts.exclude)) continue;
      const nodeRefs = (item.members ?? []).filter((m) => m.type === "node").map((m) => m.ref);
      if (nodeRefs.length === 0) continue; // senza nodi membri non si ricava una posizione
      const refStart = refs.len;
      for (const r of nodeRefs) refs.push(r);
      rels.push({ id: item.id, tagsJson: JSON.stringify(tags), refStart, refEnd: refs.len });
    }
  }
  return { ways, rels, refs, nodesAfterWays, scannedWays };
}

type Stats = {
  rows: number;
  bytes: number;
  byKind: Map<string, number>;
  skippedNewer: number;
};

function makeWriter(db: Database.Database | null, pbfTime: number) {
  const stats: Stats = { rows: 0, bytes: 0, byKind: new Map(), skippedNewer: 0 };
  let batch: UpsertOutdoorFeatureInput[] = [];
  // Una riga Overpass più recente del PBF non viene sovrascritta con dati più vecchi.
  const newerStmt = db?.prepare(`SELECT 1 FROM outdoor_features WHERE id = ? AND source = 'overpass' AND updated_at > ?`);
  let upsertBatch: ((d: Database.Database, rows: UpsertOutdoorFeatureInput[]) => void) | null = null;

  return {
    stats,
    setUpsert(fn: typeof upsertBatch) {
      upsertBatch = fn;
    },
    add(f: UpsertOutdoorFeatureInput) {
      if (newerStmt?.get(outdoorFeatureId(f.osmType, f.osmId), pbfTime)) {
        stats.skippedNewer++;
        return;
      }
      stats.rows++;
      const key = `${f.grp}/${f.kind}`;
      stats.byKind.set(key, (stats.byKind.get(key) ?? 0) + 1);
      stats.bytes += JSON.stringify(f.tags).length + (f.geomJson?.length ?? 0) + f.name.length;
      if (!db) return;
      batch.push(f);
      if (batch.length >= BATCH) this.flush();
    },
    flush() {
      if (!db || batch.length === 0) return;
      upsertBatch!(db, batch);
      batch = [];
    },
  };
}

function bboxOfCoords(lats: number[], lngs: number[]) {
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

async function main() {
  const filePath = resolvePbfPath();
  const pbfTime = Math.floor(fs.statSync(filePath).mtimeMs / 1000);
  const { bbox } = opts;
  console.log(
    `[outdoor:import] ${filePath}\n  bbox ${bbox.west},${bbox.south},${bbox.east},${bbox.north} · trails=${opts.trails}` +
      ` · exclude=[${[...opts.exclude].join(",")}] · markTiles=${opts.markTiles} · dryRun=${opts.dryRun}`,
  );

  let db: Database.Database | null = null;
  let before = 0;
  let dbPath = "";
  const writerDb: { upsert?: (d: Database.Database, rows: UpsertOutdoorFeatureInput[]) => void } = {};
  if (!opts.dryRun) {
    const dbMod = await import("../src/lib/db");
    const store = await import("../src/lib/outdoor/store");
    db = dbMod.getDb();
    dbPath = dbMod.getDbPath();
    before = store.outdoorFeatureCount(db);
    writerDb.upsert = store.upsertOutdoorFeatureBatch;
    console.log(`  DB ${dbPath} (${mb(fs.statSync(dbPath).size)}, features esistenti: ${before.toLocaleString()})`);
  }
  const writer = makeWriter(db, pbfTime);
  writer.setUpsert(writerDb.upsert ?? null);

  const t0 = Date.now();
  const A = await passWaysRelations(filePath);
  const tA = Date.now();
  console.log(
    `[outdoor:import] A: ${A.scannedWays.toLocaleString()} way lette, candidate ${A.ways.length.toLocaleString()} way` +
      ` + ${A.rels.length.toLocaleString()} relazioni, ${A.refs.len.toLocaleString()} rif. nodo` +
      ` (${((tA - t0) / 1000).toFixed(0)} s, RSS ${heap()})`,
  );

  const needed = sortedUnique(A.refs.view());
  const lat7 = new Int32Array(needed.length).fill(0x7fffffff);
  const lng7 = new Int32Array(needed.length);
  const covered = new Set<number>();
  let nodesInBbox = 0;
  let nodesRead = 0;

  for await (const item of iterateOsmPbf(filePath)) {
    if (item.type !== "node") {
      if (!A.nodesAfterWays) break;
      continue;
    }
    nodesRead++;
    const lat = item.lat;
    const lon = item.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const idx = indexOf(needed, item.id);
    if (idx >= 0) {
      lat7[idx] = Math.round(lat * 1e7);
      lng7[idx] = Math.round(lon * 1e7);
    }
    if (!bboxContains(bbox, lat, lon)) continue;
    nodesInBbox++;
    covered.add(coverageCellKey(lon, lat));
    const tags = item.tags;
    if (!tags) continue;
    const c = classifyOutdoor("node", tags);
    if (!c || !kindAllowed(c.group, c.kind, opts.trails, opts.exclude)) continue;
    writer.add({
      osmType: "node",
      osmId: item.id,
      grp: c.group,
      kind: c.kind,
      name: featureDisplayName(tags, c.kind),
      lat,
      lng: lon,
      ele: parseEle(tags),
      tags,
      geomJson: null,
      source: "osm-pbf",
      updatedAt: pbfTime,
    });
    if (nodesRead % 20_000_000 === 0) {
      console.log(`[outdoor:import] B: ${nodesRead.toLocaleString()} nodi, ${writer.stats.rows.toLocaleString()} feature`);
    }
  }
  writer.flush();
  const tB = Date.now();
  const nodeRows = writer.stats.rows;
  console.log(
    `[outdoor:import] B: ${nodesRead.toLocaleString()} nodi letti (${nodesInBbox.toLocaleString()} in bbox), ` +
      `${nodeRows.toLocaleString()} feature puntuali (${((tB - tA) / 1000).toFixed(0)} s, RSS ${heap()})`,
  );

  const coordsOf = (cand: Cand) => {
    const lats: number[] = [];
    const lngs: number[] = [];
    for (let i = cand.refStart; i < cand.refEnd; i++) {
      const k = indexOf(needed, A.refs.buf[i]!);
      if (k < 0 || lat7[k] === 0x7fffffff) continue;
      lats.push(lat7[k]! / 1e7);
      lngs.push(lng7[k]! / 1e7);
    }
    return { lats, lngs };
  };
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

  for (const w of A.ways) {
    const tags = JSON.parse(w.tagsJson) as Record<string, string>;
    const c = classifyOutdoor("way", tags)!;
    const { lats, lngs } = coordsOf(w);
    if (lats.length === 0 || (c.geom === "line" && lats.length < 2)) continue;
    const lat = mean(lats);
    const lng = mean(lngs);
    if (!bboxContains(bbox, lat, lng)) continue;
    let geomJson: string | null = null;
    if (c.geom === "line") {
      const positions = lats.map((la, i) => [lngs[i]!, la] as [number, number]);
      geomJson = JSON.stringify({ type: "LineString", coordinates: simplifyLineString(positions, 0.00008) });
    }
    writer.add({
      osmType: "way",
      osmId: w.id,
      grp: c.group,
      kind: c.kind,
      name: featureDisplayName(tags, c.kind),
      lat,
      lng,
      ele: parseEle(tags),
      tags,
      geomJson,
      bbox: c.geom === "point" ? undefined : bboxOfCoords(lats, lngs),
      source: "osm-pbf",
      updatedAt: pbfTime,
    });
  }
  writer.flush();
  const wayRows = writer.stats.rows - nodeRows;

  for (const r of A.rels) {
    const tags = JSON.parse(r.tagsJson) as Record<string, string>;
    const c = classifyOutdoor("relation", tags)!;
    const { lats, lngs } = coordsOf(r);
    if (lats.length === 0) continue;
    const lat = mean(lats);
    const lng = mean(lngs);
    if (!bboxContains(bbox, lat, lng)) continue;
    writer.add({
      osmType: "relation",
      osmId: r.id,
      grp: c.group,
      kind: c.kind,
      name: featureDisplayName(tags, c.kind),
      lat,
      lng,
      ele: parseEle(tags),
      tags,
      geomJson: null,
      source: "osm-pbf",
      updatedAt: pbfTime,
    });
  }
  writer.flush();
  const relRows = writer.stats.rows - nodeRows - wayRows;
  const tC = Date.now();

  const tiles = fullyCoveredTilesZ10(bbox, covered);
  const tileSource = opts.trails === "all" ? "osm-pbf" : `osm-pbf:trails=${opts.trails}`;
  if (db && opts.markTiles) {
    const store = await import("../src/lib/outdoor/store");
    db.transaction(() => {
      for (const t of tiles) store.markOutdoorTile(db!, 10, t.x, t.y, tileSource, pbfTime);
    })();
  }

  console.log(
    `[outdoor:import] feature: ${writer.stats.rows.toLocaleString()} (nodi ${nodeRows.toLocaleString()}, way ${wayRows.toLocaleString()}, ` +
      `relazioni ${relRows.toLocaleString()}); saltate perché Overpass più recente: ${writer.stats.skippedNewer}`,
  );
  console.log(
    `[outdoor:import] tile z10 coperti: ${tiles.length}${opts.markTiles && db ? ` (marcati, source='${tileSource}')` : " (non marcati)"}`,
  );
  const byGrp = new Map<string, number>();
  for (const [k, n] of writer.stats.byKind) {
    const g = k.split("/")[0]!;
    byGrp.set(g, (byGrp.get(g) ?? 0) + n);
  }
  console.log("[outdoor:import] per gruppo:");
  for (const [g, n] of [...byGrp].sort((a, b) => b[1] - a[1])) console.log(`  ${g}: ${n.toLocaleString()}`);
  console.log("[outdoor:import] tipi principali:");
  for (const [k, n] of [...writer.stats.byKind].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${k}: ${n.toLocaleString()}`);
  }
  console.log(`[outdoor:import] testo tag+geom+nome: ${mb(writer.stats.bytes)}`);

  if (db) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    const store = await import("../src/lib/outdoor/store");
    const after = store.outdoorFeatureCount(db);
    console.log(
      `[outdoor:import] DB: ${before.toLocaleString()} → ${after.toLocaleString()} feature, file ${mb(fs.statSync(dbPath).size)}`,
    );
  }
  console.log(
    `[outdoor:import] completato in ${((Date.now() - t0) / 1000).toFixed(0)} s (scrittura way/rel ${((tC - tB) / 1000).toFixed(0)} s)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
