/**
 * Parsing puro dei bollettini valanghe CAAML v6 (formato JSON EAWS) e logica derivata.
 * Nessun I/O: importabile anche lato client e testabile.
 */

export const ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const DANGER_LEVEL_LABELS: Record<number, string> = {
  1: "1 — Debole",
  2: "2 — Moderato",
  3: "3 — Marcato",
  4: "4 — Forte",
  5: "5 — Molto forte",
};

const DANGER_MAP: Record<string, number> = {
  low: 1,
  moderate: 2,
  considerable: 3,
  high: 4,
  very_high: 5,
};

/** Nomi italiani dei problemi valanghivi tipici EAWS. */
export const PROBLEM_LABELS: Record<string, string> = {
  new_snow: "Neve fresca",
  wind_slab: "Neve ventata",
  persistent_weak_layers: "Strati deboli persistenti",
  wet_snow: "Neve bagnata",
  gliding_snow: "Valanghe di slittamento",
  cornices: "Cornici",
  favourable_situation: "Situazione favorevole",
  no_distinct_avalanche_problem: "Nessun problema valanghivo evidente",
};

export const TENDENCY_LABELS: Record<string, string> = {
  decreasing: "Pericolo in diminuzione",
  steady: "Pericolo stazionario",
  increasing: "Pericolo in aumento",
};

export type ElevationBand = { lower: string | null; upper: string | null };

export type DangerRatingDetail = {
  level: number | null;
  /** "no_snow" / "no_rating" quando il bollettino non assegna un grado. */
  raw: string;
  elevation: ElevationBand;
  aspects: Aspect[];
  period: string;
};

export type AvalancheProblemDetail = {
  type: string;
  label: string;
  aspects: Aspect[];
  elevation: ElevationBand;
  size: number | null;
  period: string;
  comment: string | null;
};

export type RegionBulletin = {
  regionId: string;
  regionName: string;
  bulletinId: string | null;
  provider: { name: string; website: string | null };
  lang: string | null;
  publicationTime: string | null;
  validFrom: string | null;
  validUntil: string | null;
  unscheduled: boolean;
  maxDanger: number | null;
  /** Bollettino emesso senza grado: "no_snow" (assenza di neve) o "no_rating". */
  ratingNote: "no_snow" | "no_rating" | null;
  ratings: DangerRatingDetail[];
  problems: AvalancheProblemDetail[];
  tendency: { type: string | null; label: string | null; comment: string | null } | null;
  highlights: string | null;
  activityComment: string | null;
  snowpackComment: string | null;
};

type Raw = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Rimuove HTML (tendenza SLF, `<br/>` AINEVA) e comprime gli spazi. */
export function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/(p|h\d|li)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

export function dangerFromValue(v: unknown): number | null {
  if (typeof v === "number" && v >= 1 && v <= 5) return Math.round(v);
  if (typeof v === "string") return DANGER_MAP[v.toLowerCase()] ?? null;
  return null;
}

export function dangerLabel(level: number | null): string {
  if (level == null) return "N/D";
  return DANGER_LEVEL_LABELS[level] ?? String(level);
}

/** Etichetta del grado di un bollettino emesso, anche quando non assegna un grado. */
export function bulletinDangerLabel(b: Pick<RegionBulletin, "maxDanger" | "ratingNote">): string {
  if (b.maxDanger != null) return dangerLabel(b.maxDanger);
  return b.ratingNote === "no_snow" ? "Senza neve" : "Grado non assegnato";
}

const ASPECT_ALIASES: Record<string, Aspect> = {
  N: "N",
  NE: "NE",
  E: "E",
  SE: "SE",
  S: "S",
  SW: "SW",
  W: "W",
  NW: "NW",
  // italiano
  O: "W",
  NO: "NW",
  SO: "SW",
};

export function normalizeAspect(raw: unknown): Aspect | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim().toUpperCase();
  return ASPECT_ALIASES[k] ?? null;
}

export function normalizeAspects(raw: unknown): Aspect[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<Aspect>();
  for (const a of raw) {
    const n = normalizeAspect(a);
    if (n) out.add(n);
  }
  return ASPECTS.filter((a) => out.has(a));
}

function parseElevation(raw: unknown): ElevationBand {
  const e = (raw ?? {}) as Raw;
  const lb = e.lowerBound;
  const ub = e.upperBound;
  return {
    lower: lb == null ? null : String(lb),
    upper: ub == null ? null : String(ub),
  };
}

function boundLabel(v: string): string {
  if (v.toLowerCase() === "treeline") return "limite del bosco";
  return /^\d+$/.test(v) ? `${v} m` : v;
}

/** «sopra 2100 m», «sotto il limite del bosco», «tra 1800 e 2400 m», «a tutte le quote». */
export function elevationBandLabel(b: ElevationBand): string {
  if (b.lower && b.upper) return `tra ${boundLabel(b.lower)} e ${boundLabel(b.upper)}`;
  if (b.lower) return `sopra ${boundLabel(b.lower).replace(/^limite/, "il limite")}`;
  if (b.upper) return `sotto ${boundLabel(b.upper).replace(/^limite/, "il limite")}`;
  return "a tutte le quote";
}

/**
 * Parsa il JSON CAAML v6 di un fornitore EAWS (`{ bulletins: [...] }`) e restituisce
 * un elemento per ogni micro-regione citata.
 */
export function parseCaamlBulletins(json: unknown): RegionBulletin[] {
  const bulletins = ((json ?? {}) as Raw).bulletins;
  if (!Array.isArray(bulletins)) return [];
  const out: RegionBulletin[] = [];
  for (const b of bulletins as Raw[]) {
    const ratingsRaw = Array.isArray(b.dangerRatings) ? (b.dangerRatings as Raw[]) : [];
    const ratings: DangerRatingDetail[] = ratingsRaw.map((r) => ({
      level: dangerFromValue(r.mainValue),
      raw: String(r.mainValue ?? ""),
      elevation: parseElevation(r.elevation),
      aspects: normalizeAspects(r.aspects),
      period: String(r.validTimePeriod ?? "all_day"),
    }));
    let maxDanger: number | null = null;
    for (const r of ratings) if (r.level != null && (maxDanger == null || r.level > maxDanger)) maxDanger = r.level;
    const ratingNote: RegionBulletin["ratingNote"] =
      maxDanger != null ? null : ratings.some((r) => r.raw === "no_snow") ? "no_snow" : "no_rating";

    const problemsRaw = Array.isArray(b.avalancheProblems) ? (b.avalancheProblems as Raw[]) : [];
    const problems: AvalancheProblemDetail[] = problemsRaw
      .map((p) => {
        const type = String(p.problemType ?? "");
        return {
          type,
          label: PROBLEM_LABELS[type] ?? type.replace(/_/g, " "),
          aspects: normalizeAspects(p.aspects),
          elevation: parseElevation(p.elevation),
          size: typeof p.avalancheSize === "number" ? p.avalancheSize : null,
          period: String(p.validTimePeriod ?? "all_day"),
          comment: stripHtml(str(p.comment)),
        };
      })
      .filter((p) => p.type);

    const tendRaw = Array.isArray(b.tendency) ? (b.tendency as Raw[])[0] : undefined;
    const tendType = tendRaw ? str(tendRaw.tendencyType) : null;
    const tendency = tendRaw
      ? {
          type: tendType,
          label: tendType ? (TENDENCY_LABELS[tendType] ?? tendType) : null,
          comment: stripHtml(str(tendRaw.comment)),
        }
      : null;

    const activity = (b.avalancheActivity ?? {}) as Raw;
    const snowpack = (b.snowpackStructure ?? {}) as Raw;
    const valid = (b.validTime ?? {}) as Raw;
    const provider = (((b.source ?? {}) as Raw).provider ?? {}) as Raw;

    const regions = Array.isArray(b.regions) ? (b.regions as Raw[]) : [];
    for (const reg of regions) {
      const id = str(reg.regionID);
      if (!id) continue;
      const name = str(reg.name);
      out.push({
        regionId: id,
        regionName: name && name !== id ? name : id,
        bulletinId: str(b.bulletinID),
        provider: { name: str(provider.name) ?? "EAWS", website: str(provider.website) },
        lang: str(b.lang),
        publicationTime: str(b.publicationTime),
        validFrom: str(valid.startTime),
        validUntil: str(valid.endTime),
        unscheduled: b.unscheduled === true,
        maxDanger,
        ratingNote,
        ratings,
        problems,
        tendency,
        highlights: stripHtml(str(activity.highlights)),
        activityComment: stripHtml(str(activity.comment)),
        snowpackComment: stripHtml(str(snowpack.comment)),
      });
    }
  }
  return out;
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Il bollettino è valido all'istante `now`? */
export function isBulletinValidAt(b: Pick<RegionBulletin, "validFrom" | "validUntil">, now: number): boolean {
  const from = ms(b.validFrom);
  const until = ms(b.validUntil);
  if (until == null) return false;
  return (from == null || from <= now) && now < until;
}

/**
 * Per ogni regione sceglie il bollettino valido adesso (pubblicazione più recente)
 * e, separatamente, il prossimo già pubblicato ma non ancora in vigore.
 */
export function selectRegionBulletins(
  all: RegionBulletin[],
  now: number,
): { current: Map<string, RegionBulletin>; next: Map<string, RegionBulletin> } {
  const current = new Map<string, RegionBulletin>();
  const next = new Map<string, RegionBulletin>();
  const pub = (b: RegionBulletin) => ms(b.publicationTime) ?? 0;
  for (const b of all) {
    if (isBulletinValidAt(b, now)) {
      const prev = current.get(b.regionId);
      if (!prev || pub(b) > pub(prev)) current.set(b.regionId, b);
    } else {
      const from = ms(b.validFrom);
      if (from != null && from > now) {
        const prev = next.get(b.regionId);
        if (!prev || (ms(prev.validFrom) ?? Infinity) > from || ((ms(prev.validFrom) ?? 0) === from && pub(b) > pub(prev))) {
          next.set(b.regionId, b);
        }
      }
    }
  }
  return { current, next };
}

const MAX_BULLETIN_CACHE_MS = 3 * 3600_000;
const MIN_BULLETIN_CACHE_MS = 5 * 60_000;
const EMPTY_BULLETIN_CACHE_MS = 60 * 60_000;

/**
 * Durata della cache del bollettino: fino alla prima scadenza (`validUntil`) tra i
 * bollettini in vigore, mai oltre 3 ore; 1 ora se non c'è alcun bollettino in vigore.
 */
export function bulletinCacheTtlMs(validUntils: (string | null)[], now: number): number {
  let earliest: number | null = null;
  for (const v of validUntils) {
    const t = ms(v);
    if (t != null && t > now && (earliest == null || t < earliest)) earliest = t;
  }
  if (earliest == null) return EMPTY_BULLETIN_CACHE_MS;
  return Math.max(MIN_BULLETIN_CACHE_MS, Math.min(MAX_BULLETIN_CACHE_MS, earliest - now));
}

/** Grado applicabile a una porzione di micro-regione divisa per quota ("high"/"low"). */
export function dangerForElevationBand(b: RegionBulletin, band: string | null | undefined): number | null {
  const want = (band ?? "all").toLowerCase();
  let best: number | null = null;
  for (const r of b.ratings) {
    if (r.level == null) continue;
    const applies =
      want === "high"
        ? r.elevation.upper == null || r.elevation.lower != null
        : want === "low"
          ? r.elevation.lower == null || r.elevation.upper != null
          : true;
    if (applies && (best == null || r.level > best)) best = r.level;
  }
  return best;
}

function numBound(v: string | null): number | null {
  if (v == null) return null;
  return /^\d+$/.test(v) ? Number(v) : null;
}

/**
 * La fascia di quota del problema si sovrappone a quella del percorso?
 * "treeline" o quote ignote → si assume di sì (prudenza).
 */
export function elevationOverlaps(
  band: ElevationBand,
  route: { minEle?: number | null; maxEle?: number | null } | null | undefined,
): boolean {
  if (!route) return true;
  const lo = numBound(band.lower);
  const hi = numBound(band.upper);
  if (lo != null && route.maxEle != null && route.maxEle < lo) return false;
  if (hi != null && route.minEle != null && route.minEle > hi) return false;
  return true;
}

export type AspectCheck = {
  status: "no_bulletin" | "unknown_route" | "match" | "no_match" | "no_aspects";
  matchedAspects: Aspect[];
  criticalAspects: Aspect[];
  matchedProblems: string[];
  text: string;
};

/**
 * Incrocia le esposizioni del percorso (es. ["N","NW"]) con quelle critiche indicate
 * dal bollettino (problemi valanghivi e, se presenti, aspetti dei gradi di pericolo).
 */
export function checkRouteAspects(
  routeOrientations: readonly string[] | null | undefined,
  bulletin: RegionBulletin | null | undefined,
  routeElevation?: { minEle?: number | null; maxEle?: number | null } | null,
): AspectCheck {
  if (!bulletin) {
    return {
      status: "no_bulletin",
      matchedAspects: [],
      criticalAspects: [],
      matchedProblems: [],
      text: "Nessun bollettino valanghe disponibile per questa zona: non è possibile confrontare le esposizioni.",
    };
  }

  const relevant = bulletin.problems.filter(
    (p) => p.type !== "favourable_situation" && p.type !== "no_distinct_avalanche_problem",
  );
  const critical = new Set<Aspect>();
  for (const p of relevant) if (elevationOverlaps(p.elevation, routeElevation)) p.aspects.forEach((a) => critical.add(a));
  for (const r of bulletin.ratings) if (elevationOverlaps(r.elevation, routeElevation)) r.aspects.forEach((a) => critical.add(a));
  const criticalAspects = ASPECTS.filter((a) => critical.has(a));
  const grade = bulletin.maxDanger != null ? `grado ${dangerLabel(bulletin.maxDanger)}` : bulletinDangerLabel(bulletin).toLowerCase();

  const route = normalizeAspects(routeOrientations ?? []);
  if (route.length === 0) {
    return {
      status: "unknown_route",
      matchedAspects: [],
      criticalAspects,
      matchedProblems: [],
      text: criticalAspects.length
        ? `Esposizioni del percorso non note: confronta i pendii che attraversi con quelle critiche del bollettino (${criticalAspects.join(", ")}).`
        : `Esposizioni del percorso non note; il bollettino non indica esposizioni critiche specifiche (${grade}).`,
    };
  }

  if (criticalAspects.length === 0) {
    return {
      status: "no_aspects",
      matchedAspects: [],
      criticalAspects,
      matchedProblems: [],
      text: `Il bollettino non indica esposizioni critiche specifiche per la fascia di quota del percorso (${grade}). Valuta comunque i pendii sul posto.`,
    };
  }

  const matched = route.filter((a) => critical.has(a));
  if (matched.length === 0) {
    return {
      status: "no_match",
      matchedAspects: [],
      criticalAspects,
      matchedProblems: [],
      text: `Le esposizioni del percorso (${route.join(", ")}) non sono tra quelle critiche del bollettino (${criticalAspects.join(", ")}). Il pericolo resta ${grade}: valuta sempre sul posto.`,
    };
  }

  const matchedProblems = relevant
    .filter((p) => elevationOverlaps(p.elevation, routeElevation) && p.aspects.some((a) => matched.includes(a)))
    .map((p) => `${p.label} (${elevationBandLabel(p.elevation)})`);

  return {
    status: "match",
    matchedAspects: matched,
    criticalAspects,
    matchedProblems,
    text:
      `Il percorso è esposto a ${matched.join(", ")}: esposizion${matched.length === 1 ? "e critica" : "i critiche"} nel bollettino` +
      (matchedProblems.length ? ` per ${matchedProblems.join("; ")}` : "") +
      `. Pericolo ${grade}.`,
  };
}

type Ring = number[][];

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Punto (lng, lat) dentro un Polygon/MultiPolygon GeoJSON (con buchi). */
export function pointInGeometry(lng: number, lat: number, geom: GeoJSON.Geometry | null | undefined): boolean {
  if (!geom) return false;
  const polys: Ring[][] =
    geom.type === "Polygon"
      ? [geom.coordinates as Ring[]]
      : geom.type === "MultiPolygon"
        ? (geom.coordinates as Ring[][])
        : [];
  for (const poly of polys) {
    if (!poly[0] || !pointInRing(lng, lat, poly[0])) continue;
    let inHole = false;
    for (let k = 1; k < poly.length; k++) {
      if (pointInRing(lng, lat, poly[k])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}
