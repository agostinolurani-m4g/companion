/**
 * CLI: snapshot superficie OSM. Logica in src/lib/snapshot-surface-run.ts
 */
import { getFirstTrack, getTrack } from "../src/lib/db";
import { runSurfaceSnapshotForTrack } from "../src/lib/snapshot-surface-run";

function resolveTrackId(): string {
  const envId = process.env.TRACK_ID?.trim();
  if (envId) {
    if (!getTrack(envId)) {
      console.error(`[surface] TRACK_ID=${envId} non trovato.`);
      process.exit(1);
    }
    return envId;
  }
  const t = getFirstTrack();
  if (!t) {
    console.error("[surface] Nessuna traccia. Esegui npm run ingest.");
    process.exit(1);
  }
  return t.id;
}

async function main() {
  await runSurfaceSnapshotForTrack(resolveTrackId());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
