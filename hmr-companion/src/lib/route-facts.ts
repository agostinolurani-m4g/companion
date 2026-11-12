/**
 * Fatti di un percorso normalizzati da `meta_json` di tutte le origini (camptocamp sci,
 * camptocamp altre attività, OpenStreetMap, upload utente). Funzione pura, nessun I/O.
 */
import { lookupGrade, type Grade, type ScaleId } from "@/lib/content/difficulty-scales";
import { buildFallbackDescription } from "@/lib/route-description";
import type { RouteShape } from "@/lib/route-shape";
import { estimateDurationMin, formatDuration } from "@/lib/route-time";
import type { UserRouteActivity } from "@/lib/sports";

export type RouteFactsInput = {
  activity: UserRouteActivity;
  source: string | null;
  owner?: string | null;
  meta_json: string | Record<string, unknown> | null;
  length_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  license?: string | null;
  source_url?: string | null;
};

export type LocalizedText = { text: string; lang: string | null };

export type RouteFacts = {
  /** Gradi di difficoltà, il primo è il principale per lo sport. */
  difficulty: Grade[];
  /** Tempo in movimento stimato (minuti), sempre da `estimateDurationMin`. */
  durationMin: number | null;
  durationLabel: string | null;
  /** Gite di più giorni secondo la fonte (es. «2 giorni»), solo se ≥ 2. */
  daysLabel: string | null;
  orientations: string[];
  elevation: { min: number | null; max: number | null; source: "source" | "dem" | null };
  waymark: { ref: string | null; operator: string | null; symbol: string | null; network: string | null } | null;
  from: string | null;
  to: string | null;
  zone: string | null;
  summary: LocalizedText | null;
  description: (LocalizedText & { generated: boolean }) | null;
  routeType: RouteShape | null;
  osm: { sacMax: string | null; sacPrevalent: string | null; surface: string | null; equippedM: number } | null;
  access: { name: string | null; lng: number | null; lat: number | null } | null;
  attribution: { label: string; license: string | null; url: string | null } | null;
};

type Meta = Record<string, unknown>;

function parseMeta(raw: RouteFactsInput["meta_json"]): Meta {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Meta) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const CARDINAL_IT: Record<string, string> = { N: "N", NE: "NE", E: "E", SE: "SE", S: "S", SW: "SO", W: "O", NW: "NO", O: "O", SO: "SO", NO: "NO" };

function parseOrientations(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;/-]+/) : [];
  const out: string[] = [];
  for (const x of list) {
    const s = typeof x === "string" ? x.trim().toUpperCase() : "";
    if ((CARDINALS.includes(s) || s in CARDINAL_IT) && !out.includes(CARDINAL_IT[s]!)) out.push(CARDINAL_IT[s]!);
  }
  return out;
}

/** Ripulisce il markup camptocamp (markdown + link [[routes/1|testo]]). */
export function cleanC2cMarkup(text: string): string {
  return text
    .replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1$2")
    .replace(/^\s*L#\s*/gm, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pushGrade(out: Grade[], scale: ScaleId, raw: unknown) {
  const g = lookupGrade(scale, raw);
  if (g && !out.some((x) => x.scale === g.scale && x.value === g.value)) out.push(g);
}

function difficultyFor(input: RouteFactsInput, m: Meta): Grade[] {
  const out: Grade[] = [];
  const isC2c = input.source === "camptocamp";
  if (isC2c && (input.activity === "ski" || m.ski_rating != null)) {
    pushGrade(out, "toponeige", m.ski_rating);
    pushGrade(out, "ski_exposition", m.ski_exposition);
    pushGrade(out, "labande_ski", m.labande_ski_rating);
    pushGrade(out, "ifas", m.labande_global_rating);
    return out;
  }
  if (isC2c) {
    const act = str(m.c2c_activity);
    switch (act) {
      case "hiking":
        pushGrade(out, "sac", m.hiking_rating);
        pushGrade(out, "ski_exposition", m.hiking_mtb_exposition);
        break;
      case "via_ferrata":
        pushGrade(out, "husler", m.via_ferrata_rating);
        pushGrade(out, "ifas", m.global_rating);
        break;
      case "snowshoeing":
        pushGrade(out, "snowshoe_c2c", m.snowshoe_rating);
        pushGrade(out, "ifas", m.global_rating);
        break;
      case "mountain_biking":
        pushGrade(out, "mtb_c2c_down", m.mtb_down_rating);
        pushGrade(out, "mtb_c2c_up", m.mtb_up_rating);
        break;
      default:
        pushGrade(out, "ifas", m.global_rating);
        pushGrade(out, "sac", m.hiking_rating);
    }
    return out;
  }
  if (input.source === "osm") {
    const wf = (m.way_facts ?? null) as Meta | null;
    pushGrade(out, "sac", wf?.sac_max ?? m.sac_scale);
    pushGrade(out, "mtb_scale", wf?.mtb_scale_max ?? m["mtb:scale"]);
    return out;
  }
  // Upload utente: testo libero → prova le scale note.
  const raw = str(m.difficulty);
  if (raw) {
    for (const scale of ["toponeige", "ifas", "sac", "husler", "wt", "labande_ski"] as ScaleId[]) {
      const g = lookupGrade(scale, raw);
      if (g) {
        out.push(g);
        break;
      }
    }
  }
  pushGrade(out, "ski_exposition", m.exposition);
  return out;
}

function daysLabel(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  const days = v.map((x) => num(x)).filter((n): n is number => n != null && n > 0);
  if (!days.length) return null;
  const lo = Math.min(...days);
  const hi = Math.max(...days);
  if (hi < 2) return null;
  return lo === hi ? `${hi} giorni` : `${lo}–${hi} giorni`;
}

/** `route_types` camptocamp → forma del percorso. */
export function c2cRouteType(v: unknown): RouteShape | null {
  const types = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  if (types.includes("return_same_way")) return "andata_ritorno";
  if (types.includes("loop") || types.includes("loop_hut")) return "anello";
  if (types.includes("traverse")) return "traversata";
  return null;
}

const SOURCE_LABEL: Record<string, string> = {
  camptocamp: "camptocamp.org",
  osm: "OpenStreetMap",
  gulliver: "Gulliver",
};

export function computeRouteFacts(input: RouteFactsInput): RouteFacts {
  const m = parseMeta(input.meta_json);
  const derived = (m.derived ?? null) as Meta | null;
  const wf = (m.way_facts ?? null) as Meta | null;

  const difficulty = difficultyFor(input, m);

  const est = estimateDurationMin(input.activity, input.length_km, input.elev_gain_m, input.elev_loss_m);
  const durationMin = est > 0 ? est : null;

  const srcMax = num(m.elevation_max) ?? num(m.elevation_max_m);
  const srcMin = num(m.elevation_min);
  const demMax = num(derived?.ele_max_dem);
  const demMin = num(derived?.ele_min_dem);
  const elevation =
    srcMax != null || srcMin != null
      ? { min: srcMin ?? demMin, max: srcMax ?? demMax, source: "source" as const }
      : demMax != null || demMin != null
        ? { min: demMin, max: demMax, source: "dem" as const }
        : { min: null, max: null, source: null };

  const ref = str(m.ref);
  const operator = str(m.operator);
  const symbol = str(m.symbol);
  const network = str(m.network_label);
  const waymark = ref || operator || symbol ? { ref, operator, symbol, network } : null;

  const orientations = parseOrientations(m.orientations ?? m.exposition);

  const summaryText = str(m.summary);
  const summary = summaryText
    ? { text: input.source === "camptocamp" ? cleanC2cMarkup(summaryText) : summaryText, lang: str(m.summary_lang) }
    : null;

  let descText = str(m.description) ?? str(m.notes);
  if (descText && input.source === "camptocamp") descText = cleanC2cMarkup(descText);
  // OSM: spesso `description` ripete solo «da – a»; non è una descrizione utile.
  const from = str(m.from);
  const to = str(m.to);
  if (descText && input.source === "osm" && from && to && descText.length < 80 && descText.includes(from) && descText.includes(to)) {
    descText = null;
  }
  // Le note dell'upload utente sono scritte nell'app (italiano); per le altre fonti la lingua è nota solo dopo l'enrich.
  const descLang = str(m.description_lang) ?? (!input.source && descText ? "it" : null);

  // camptocamp: la geometria è spesso solo la salita, quindi vale `route_types` della fonte;
  // per OSM e percorsi utente la forma calcolata dal tracciato (`derived.shape`).
  let routeType: RouteShape | null = null;
  if (input.source === "camptocamp") {
    routeType = c2cRouteType(m.route_types);
  } else {
    const shape = str(derived?.shape);
    routeType = shape === "anello" || shape === "andata_ritorno" || shape === "traversata" ? shape : null;
  }

  const osm = wf
    ? {
        sacMax: str(wf.sac_max),
        sacPrevalent: str(wf.sac_prevalent),
        surface: str(wf.surface),
        equippedM: num(wf.equipped_m) ?? 0,
      }
    : null;

  const acc = (m.access ?? null) as Meta | null;
  const access = acc ? { name: str(acc.name), lng: num(acc.lng), lat: num(acc.lat) } : null;

  const durationLabel = durationMin != null ? formatDuration(durationMin) : null;

  let description: RouteFacts["description"] = descText ? { text: descText, lang: descLang, generated: false } : null;
  if (!description && !summary) {
    description = buildFallbackDescription({
      lengthKm: input.length_km,
      gainM: input.elev_gain_m,
      routeType,
      elevationMax: elevation.max,
      difficulty,
      durationLabel,
      waymark,
      from,
      to,
      orientations,
      surface: osm?.surface ?? null,
      equippedM: osm?.equippedM ?? null,
    });
  }

  const attribution = input.source
    ? { label: SOURCE_LABEL[input.source] ?? input.source, license: input.license ?? null, url: input.source_url ?? null }
    : null;

  return {
    difficulty,
    durationMin,
    durationLabel,
    daysLabel: daysLabel(m.durations),
    orientations,
    elevation,
    waymark,
    from,
    to,
    zone: str(m.zone),
    summary,
    description,
    routeType,
    osm,
    access,
    attribution,
  };
}

/** Versione compatta per le righe elenco (payload leggero). */
export function routeFactsBrief(f: RouteFacts): { difficulty_label: string | null; duration_min: number | null } {
  return { difficulty_label: f.difficulty[0]?.value ?? null, duration_min: f.durationMin };
}
