/** Etichette italiane e formattatori per tag OSM comuni in scheda feature. */

const BOOL_IT: Record<string, string> = {
  yes: "Sì",
  no: "No",
  seasonal: "Stagionale",
  private: "Privato",
  permissive: "Permissivo",
  customers: "Solo clienti",
};

const SAC_SCALE: Record<string, string> = {
  hiking: "T1 — Sentiero",
  mountain_hiking: "T2 — Escursionismo",
  demanding_mountain_hiking: "T3 — Escursionismo impegnativo",
  alpine_hiking: "T4 — Alpinismo",
  demanding_alpine_hiking: "T5 — Alpinismo impegnativo",
  difficult_alpine_hiking: "T6 — Alpinismo difficile",
};

const VIA_FERRATA: Record<string, string> = {
  "0": "Facile",
  "1": "Poco difficile",
  "2": "Difficile",
  "3": "Molto difficile",
  "4": "Estremamente difficile",
  "5": "Molto estremamente difficile",
};

const SHELTER_TYPE: Record<string, string> = {
  basic_hut: "Riparo semplice",
  lean_to: "Tettoia",
  weather_shelter: "Riparo meteo",
  picnic_shelter: "Riparo picnic",
  public_transport: "Fermata coperta",
};

const TRAIL_VISIBILITY: Record<string, string> = {
  excellent: "Ottima",
  good: "Buona",
  intermediate: "Media",
  bad: "Scarsa",
  horrible: "Pessima",
  no: "Assente",
};

const SURFACE: Record<string, string> = {
  paved: "Asfalto / pavimentato",
  asphalt: "Asfalto",
  gravel: "Ghiaia",
  fine_gravel: "Ghiaia fine",
  ground: "Terra",
  grass: "Erba",
  dirt: "Sterrato",
  mud: "Fango",
  rock: "Roccia",
  stone: "Pietra",
  wood: "Legno",
  snow: "Neve",
  ice: "Ghiaccio",
};

const TRACKTYPE: Record<string, string> = {
  grade1: "Grado 1 (solido)",
  grade2: "Grado 2",
  grade3: "Grado 3",
  grade4: "Grado 4",
  grade5: "Grado 5 (incolto)",
};

const PISTE_DIFF: Record<string, string> = {
  novice: "Verde",
  easy: "Blu",
  intermediate: "Rosso",
  advanced: "Nero",
  expert: "Nero",
  freeride: "Freeride",
};

const RESERVATION: Record<string, string> = {
  required: "Obbligatoria",
  recommended: "Consigliata",
  yes: "Possibile",
  no: "Non prevista",
  members_only: "Solo soci",
};

const OH_TOKENS: Record<string, string> = {
  Mo: "lun",
  Tu: "mar",
  We: "mer",
  Th: "gio",
  Fr: "ven",
  Sa: "sab",
  Su: "dom",
  PH: "festivi",
  SH: "vacanze scolastiche",
  Jan: "gen",
  Feb: "feb",
  Mar: "mar",
  Apr: "apr",
  May: "mag",
  Jun: "giu",
  Jul: "lug",
  Aug: "ago",
  Sep: "set",
  Oct: "ott",
  Nov: "nov",
  Dec: "dic",
  off: "chiuso",
  closed: "chiuso",
  open: "aperto",
};

/** Traduzione leggera di `opening_hours` OSM (giorni, mesi, 24/7, off). */
export function formatOpeningHours(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (v === "24/7") return "Sempre aperto";
  return v
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|off|closed|open)\b/g, (m) =>
      OH_TOKENS[m] ?? m,
    )
    .replace(/\s*;\s*/g, "; ");
}

function websiteHref(raw: string): string {
  const v = raw.trim();
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function websiteLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

function splitMulti(raw: string): string[] {
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type TagRow = { key: string; label: string; value: string; href?: string };

const KEY_LABELS: Record<string, string> = {
  ele: "Quota (m)",
  capacity: "Posti letto",
  beds: "Letti",
  fireplace: "Camino / stufa",
  stove: "Stufa",
  drinking_water: "Acqua potabile",
  water_source: "Fonte acqua",
  reservation: "Prenotazione",
  opening_hours: "Apertura",
  winter_room: "Locale invernale",
  "capacity:winter_room": "Posti locale invernale",
  shower: "Doccia",
  toilets: "Servizi igienici",
  mattress: "Materassi",
  "contact:phone": "Telefono",
  "contact:mobile": "Cellulare",
  "contact:website": "Sito web",
  "contact:email": "Email",
  "ref:refuges.info": "ID refuges.info",
  operator: "Gestore",
  shelter_type: "Tipo riparo",
  sac_scale: "Scala SAC",
  direction: "Direzione",
  via_ferrata_scale: "Difficoltà ferrata",
  seasonal: "Stagionale",
  access: "Accesso",
  fee: "A pagamento",
  phone: "Telefono",
  website: "Sito web",
  email: "Email",
  ref: "Riferimento",
  "ref:CAI": "Rif. CAI",
  "ref:REI": "Rif. REI",
  trail_visibility: "Tracciabilità",
  surface: "Superficie",
  tracktype: "Tipo mulattiera",
  "mtb:scale": "Difficoltà MTB",
  "piste:difficulty": "Difficoltà pista",
  "piste:type": "Tipo pista",
  width: "Larghezza",
  incline: "Pendenza",
  lit: "Illuminato",
  wheelchair: "Accessibile sedia",
  description: "Descrizione",
  note: "Note",
  abandoned: "Abbandonato",
  disused: "Dismesso",
  winter_road: "Strada invernale",
  summit: "Vetta",
  "summit:cross": "Croce di vetta",
  climbing: "Arrampicata",
  sport: "Sport",
  tourism: "Turismo",
  natural: "Naturale",
  highway: "Tipo percorso",
  aerialway: "Funivia",
  emergency: "Emergenza",
  information: "Informazioni",
};

function formatValue(key: string, raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (key === "sac_scale") return SAC_SCALE[v] ?? v;
  if (key === "via_ferrata_scale") return VIA_FERRATA[v] ?? v;
  if (key === "shelter_type") return SHELTER_TYPE[v] ?? v;
  if (key === "trail_visibility") return TRAIL_VISIBILITY[v] ?? v;
  if (key === "surface") return SURFACE[v] ?? v;
  if (key === "tracktype") return TRACKTYPE[v] ?? v;
  if (key === "piste:difficulty") return PISTE_DIFF[v] ?? v;
  if (key === "reservation") return RESERVATION[v] ?? v;
  if (key === "opening_hours" || key.startsWith("opening_hours:")) return formatOpeningHours(v);
  if (BOOL_IT[v] && (key.includes("water") || key === "fireplace" || key === "fee" || key === "lit")) {
    return BOOL_IT[v];
  }
  if (v === "yes") return "Sì";
  if (v === "no") return "No";
  return v;
}

const PRIORITY_KEYS = [
  "ele",
  "capacity",
  "beds",
  "winter_room",
  "capacity:winter_room",
  "drinking_water",
  "water_source",
  "fireplace",
  "stove",
  "shelter_type",
  "sac_scale",
  "via_ferrata_scale",
  "mtb:scale",
  "piste:difficulty",
  "ref",
  "ref:CAI",
  "opening_hours",
  "reservation",
  "operator",
  "phone",
  "website",
];

function firstTag(tags: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = tags[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** Locale invernale: `winter_room` (yes/no) e/o `capacity:winter_room`. */
function winterRoomFact(tags: Record<string, string>): TagRow | null {
  const flag = tags.winter_room?.trim();
  const capRaw = tags["capacity:winter_room"]?.trim();
  const cap = capRaw && /^\d+$/.test(capRaw) ? Number(capRaw) : null;
  if (!flag && cap == null) return null;
  if (flag === "no" || cap === 0) return { key: "winter_room", label: "Locale invernale", value: "No" };
  const parts = [flag && flag !== "yes" ? formatValue("winter_room", flag) : "Sì"];
  if (cap != null) parts.push(`${cap} posti`);
  return { key: "winter_room", label: "Locale invernale", value: parts.join(" · ") };
}

/** Fatti chiave "dopo" i dati di base: contatti con link cliccabile. */
function contactFacts(tags: Record<string, string>): TagRow[] {
  const rows: TagRow[] = [];
  const phone = firstTag(tags, ["phone", "contact:phone", "contact:mobile", "mobile"]);
  if (phone) {
    const list = splitMulti(phone);
    rows.push({
      key: "phone",
      label: "Telefono",
      value: list.join(" · "),
      href: `tel:${list[0]!.replace(/[^\d+]/g, "")}`,
    });
  }
  const site = firstTag(tags, ["website", "contact:website", "url"]);
  if (site) {
    const first = splitMulti(site)[0]!;
    rows.push({ key: "website", label: "Sito web", value: websiteLabel(first), href: websiteHref(first) });
  }
  const email = firstTag(tags, ["email", "contact:email"]);
  if (email) {
    const first = splitMulti(email)[0]!;
    rows.push({ key: "email", label: "Email", value: first, href: `mailto:${first}` });
  }
  return rows;
}

/**
 * Chip sintetici per la scheda (fatti chiave), in ordine di utilità per rifugi/bivacchi:
 * quota, posti letto, locale invernale, apertura, prenotazione, acqua, dotazioni, difficoltà,
 * gestore, contatti (telefono/sito/email con `href`).
 */
export function keyFactsFromTags(tags: Record<string, string>): TagRow[] {
  const rows: TagRow[] = [];
  const push = (key: string, raw: string | undefined, label?: string) => {
    if (!raw?.trim()) return;
    const value = formatValue(key, raw);
    if (!value) return;
    rows.push({ key, label: label ?? KEY_LABELS[key] ?? key, value });
  };

  push("ele", tags.ele);
  const beds = firstTag(tags, ["capacity", "beds"]);
  push("capacity", beds, "Posti letto");
  const winter = winterRoomFact(tags);
  if (winter) rows.push(winter);
  push("opening_hours", tags.opening_hours);
  push("reservation", tags.reservation);
  push("drinking_water", tags.drinking_water);
  push("water_source", tags.water_source);
  for (const key of ["fireplace", "stove", "shower", "mattress", "shelter_type"]) push(key, tags[key]);
  for (const key of ["sac_scale", "via_ferrata_scale", "mtb:scale", "piste:difficulty", "ref", "ref:CAI"]) {
    push(key, tags[key]);
  }
  push("operator", tags.operator);
  rows.push(...contactFacts(tags));
  return rows;
}

/** Tutti i tag con etichetta, ordinati (priorità prima). */
export function allTagRows(tags: Record<string, string>): TagRow[] {
  const keys = Object.keys(tags).filter((k) => !k.startsWith("source") && tags[k]?.trim());
  const priority = new Set(PRIORITY_KEYS);
  keys.sort((a, b) => {
    const pa = priority.has(a) ? 0 : 1;
    const pb = priority.has(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b, "it");
  });
  return keys.map((key) => ({
    key,
    label: KEY_LABELS[key] ?? key.replace(/_/g, " "),
    value: formatValue(key, tags[key] ?? ""),
  }));
}

export function tagLabel(key: string): string {
  return KEY_LABELS[key] ?? key;
}
