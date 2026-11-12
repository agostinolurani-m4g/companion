/**
 * Ricompone le vie di una relazione OSM (route=hiking/bicycle/mtb) in una linea continua.
 * Le relazioni non garantiscono ordine né verso dei membri: si concatenano greedy
 * scegliendo ogni volta il tratto con estremo più vicino, invertendolo se serve.
 */

type Pt = [number, number];
type JoinMode = "tail-start" | "tail-end" | "head-end" | "head-start";

function distM(a: Pt, b: Pt): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function lineLengthM(line: Pt[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += distM(line[i - 1]!, line[i]!);
  return s;
}

export type StitchResult = {
  /** Catena principale (la più lunga). */
  line: Pt[];
  /** Numero di catene trovate (1 = relazione continua). */
  chains: number;
  /** Quota della lunghezza totale coperta dalla catena principale (0–1). */
  coverage: number;
};

/**
 * @param ways geometrie dei membri (nell'ordine della relazione)
 * @param maxGapM distanza massima per considerare due tratti collegati
 */
export function stitchWays(ways: Pt[][], maxGapM = 60): StitchResult | null {
  const pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  if (pool.length === 0) return null;
  const totalLen = pool.reduce((s, w) => s + lineLengthM(w), 0);

  const chains: Pt[][] = [];
  while (pool.length > 0) {
    // Parte dal primo membro rimasto (rispetta l'ordine della relazione quando c'è).
    let chain = pool.shift()!;
    let grew = true;
    while (grew && pool.length > 0) {
      grew = false;
      const head = chain[0]!;
      const tail = chain[chain.length - 1]!;
      let best = -1;
      let bestD = Infinity;
      let mode: JoinMode = "tail-start";
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i]!;
        const s = w[0]!;
        const e = w[w.length - 1]!;
        const cands: [number, JoinMode][] = [
          [distM(tail, s), "tail-start"],
          [distM(tail, e), "tail-end"],
          [distM(head, e), "head-end"],
          [distM(head, s), "head-start"],
        ];
        for (const [d, m] of cands) {
          if (d < bestD) {
            bestD = d;
            best = i;
            mode = m;
          }
        }
      }
      if (best >= 0 && bestD <= maxGapM) {
        const w = pool.splice(best, 1)[0]!;
        if (mode === "tail-start") chain = chain.concat(w.slice(1));
        else if (mode === "tail-end") chain = chain.concat(w.slice().reverse().slice(1));
        else if (mode === "head-end") chain = w.slice(0, -1).concat(chain);
        else chain = w.slice().reverse().slice(0, -1).concat(chain);
        grew = true;
      }
    }
    chains.push(chain);
  }

  chains.sort((a, b) => lineLengthM(b) - lineLengthM(a));
  const main = chains[0]!;
  return {
    line: main,
    chains: chains.length,
    coverage: totalLen > 0 ? lineLengthM(main) / totalLen : 0,
  };
}

/** Dislivello positivo/negativo con soglia di isteresi (filtra il rumore del DEM). */
export function gainLossWithHysteresis(elev: number[], thresholdM = 5): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  if (elev.length === 0) return { gain, loss };
  let ref = elev[0]!;
  for (const e of elev) {
    const d = e - ref;
    if (d >= thresholdM) {
      gain += d;
      ref = e;
    } else if (d <= -thresholdM) {
      loss += -d;
      ref = e;
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}
