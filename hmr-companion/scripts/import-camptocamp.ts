/**
 * Importa itinerari estivi/invernali da camptocamp.org (oltre allo scialpinismo):
 * escursionismo, MTB, vie ferrate, ciaspole, alpinismo.
 *
 *   npm run import:c2c:all
 *   C2C_ACTS=hiking,via_ferrata C2C_MAX_PER_ACT=150 npm run import:c2c:all
 *   C2C_MAX_PER_ACT=all npm run import:c2c:all      # nessun tetto
 *
 * Licenza contenuti: CC-BY-SA 4.0 (camptocamp.org). Idempotente.
 * Logica condivisa con lo scialpinismo in scripts/lib/c2c-import.ts.
 */
import { C2C_ACTIVITY_MAP } from "../src/lib/camptocamp";
import { appActivityForC2c, envLimit, importC2cActivity } from "./lib/c2c-import";

const ACTS = (process.env.C2C_ACTS ?? Object.keys(C2C_ACTIVITY_MAP).join(","))
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is keyof typeof C2C_ACTIVITY_MAP => s in C2C_ACTIVITY_MAP);
/** Nuovi percorsi per attività (era 200 fisso). */
const MAX_PER_ACT = envLimit("C2C_MAX_PER_ACT", 1000);
const PAUSE_MS = 350;

async function main() {
  let imported = 0;
  let skipped = 0;
  for (const act of ACTS) {
    const s = await importC2cActivity(act, { max: MAX_PER_ACT, pauseMs: PAUSE_MS });
    imported += s.imported;
    skipped += s.skipped;
    console.log(`${act} → ${appActivityForC2c(act)}: +${s.imported} (saltati ${s.skipped}, visti ${s.scanned})`);
  }
  console.log(`Fatto: importati=${imported} saltati=${skipped}`);
}

void main();
