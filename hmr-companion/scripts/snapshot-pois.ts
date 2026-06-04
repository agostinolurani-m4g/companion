/**
 * CLI: snapshot Overpass → POI. La logica è in src/lib/snapshot-pois-run.ts
 */
import { getFirstTrack, getTrack } from "../src/lib/db";
import { runPoiSnapshotForTrack } from "../src/lib/snapshot-pois-run";
import type { BboxCategoryKey } from "../src/lib/overpass";

const ALL_PLAN_KEYS = [
  "water",
  "hut",
  "lodging",
  "campsite",
  "shop",
  "food",
  "health",
  "utilities",
] as const;

function parseSnapshotOnlyList(): BboxCategoryKey[] | null {
  const raw = process.env.HMR_SNAPSHOT_ONLY?.trim();
  if (!raw) return null;
  const tokens = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const out: BboxCategoryKey[] = [];
  for (const t of tokens) {
    if ((ALL_PLAN_KEYS as readonly string[]).includes(t)) {
      if (!out.includes(t as BboxCategoryKey)) out.push(t as BboxCategoryKey);
    } else {
      console.warn(`[snapshot] HMR_SNAPSHOT_ONLY: ignorata «${t}»`);
    }
  }
  if (out.length === 0) {
    console.error(`[snapshot] HMR_SNAPSHOT_ONLY non valido. Valide: ${ALL_PLAN_KEYS.join(", ")}`);
    process.exit(1);
  }
  return out;
}

function resolveTrackId(): string {
  const envId = process.env.TRACK_ID?.trim();
  if (envId) {
    if (!getTrack(envId)) {
      console.error(`[snapshot] TRACK_ID=${envId} non trovato.`);
      process.exit(1);
    }
    return envId;
  }
  const t = getFirstTrack();
  if (!t) {
    console.error("[snapshot] Nessuna traccia. Esegui `npm run ingest`.");
    process.exit(1);
  }
  return t.id;
}

async function main() {
  const trackId = resolveTrackId();
  const appendOnly =
    process.env.HMR_SNAPSHOT_APPEND === "1" || process.env.HMR_SNAPSHOT_APPEND === "true";
  await runPoiSnapshotForTrack(trackId, {
    onlyKeys: parseSnapshotOnlyList(),
    appendOnly,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
