/**
 * Import gite scialpinismo da camptocamp.org nel DB locale.
 *
 *   npm run import:c2c
 *   C2C_MAX_SKI=300 npm run import:c2c     # tetto ai nuovi percorsi (default: nessuno)
 *
 * Logica condivisa con le altre attività in scripts/lib/c2c-import.ts. Idempotente.
 */
import { envLimit, importC2cActivity } from "./lib/c2c-import";

const PAUSE_MS = 400;
const MAX = envLimit("C2C_MAX_SKI", Infinity);

async function main() {
  const s = await importC2cActivity("skitouring", { max: MAX, pauseMs: PAUSE_MS, verbose: true });
  console.log(`Done: imported=${s.imported} skipped=${s.skipped} scanned=${s.scanned}`);
}

void main();
