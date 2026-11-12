/**
 * refuges.info API (CC BY-SA 2.0) — rifugi, bivacchi, sorgenti, passaggi delicati.
 * https://www.refuges.info/api/bbox — risposta GeoJSON (proprietà in francese).
 *
 * Note verificate (11/2026): il parametro corretto è `type_points` (non `type`), il formato è
 * GeoJSON (`features[].properties`, non `places[]`) e senza `nb_points=all` la risposta è
 * troncata a 250 punti.
 */

const BASE = "https://www.refuges.info/api";

export const REFUGES_INFO_ATTRIBUTION = "Dati refuges.info, licenza CC BY-SA 2.0";

/** Valore tri-stato di info_comp ("Oui" / "Non" / "Inconnu"). */
export type TriState = boolean | null;

export type RefugesInfoPlace = {
  id: number;
  name: string;
  /** Id tipo refuges.info (7 cabane non gardée, 10 refuge gardé, 9 gîte, 23 point d'eau, …). */
  typeId: number | null;
  typeLabel: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  /** Posti per dormire (null = sconosciuto). */
  places: number | null;
  placesMattress: number | null;
  water: TriState;
  stove: TriState;
  fireplace: TriState;
  blankets: TriState;
  latrines: TriState;
  wood: TriState;
  missingWall: TriState;
  /** Stato (es. "Détruite", "Fermée"); stringa vuota = normale. */
  state: string;
  owner: string | null;
  access: string | null;
  remark: string | null;
  url: string;
  updatedAt: string | null;
};

type RawObj = Record<string, unknown>;

function obj(v: unknown): RawObj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as RawObj) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

function valeur(v: unknown): unknown {
  return obj(v)?.valeur;
}

function tri(v: unknown): TriState {
  const s = valeur(v);
  if (s === "Oui") return true;
  if (s === "Non") return false;
  return null;
}

/** Converte una Feature GeoJSON refuges.info nel formato interno; null se non valida. */
export function parseRefugesInfoFeature(feature: unknown): RefugesInfoPlace | null {
  const f = obj(feature);
  const p = obj(f?.properties);
  if (!f || !p) return null;
  const id = num(p.id) ?? num(f.id);
  const coord = obj(p.coord);
  const geomCoords = obj(f.geometry)?.coordinates;
  const lng = num(coord?.long) ?? (Array.isArray(geomCoords) ? num(geomCoords[0]) : null);
  const lat = num(coord?.lat) ?? (Array.isArray(geomCoords) ? num(geomCoords[1]) : null);
  if (id == null || lat == null || lng == null) return null;
  const type = obj(p.type);
  const info = obj(p.info_comp) ?? {};
  const placesInfo = obj(info.places);
  const places = num(placesInfo?.valeur) ?? num(valeur(p.places));
  return {
    id,
    name: str(p.nom) ?? `refuges.info ${id}`,
    typeId: num(type?.id),
    typeLabel: str(type?.valeur) ?? "",
    latitude: lat,
    longitude: lng,
    altitude: num(coord?.alt),
    places,
    placesMattress: num(obj(info.places_matelas)?.valeur),
    water: tri(info.eau),
    stove: tri(info.poele),
    fireplace: tri(info.cheminee),
    blankets: tri(info.couvertures),
    latrines: tri(info.latrines),
    wood: tri(info.bois),
    missingWall: tri(info.manque_un_mur),
    state: str(valeur(p.etat)) ?? "",
    owner: str(valeur(p.proprio)),
    access: str(valeur(p.acces)),
    remark: str(valeur(p.remarque)),
    url: str(p.lien) ?? refugesInfoExternalUrl(id),
    updatedAt: str(obj(p.date)?.derniere_modif),
  };
}

export function parseRefugesInfoResponse(data: unknown): RefugesInfoPlace[] {
  const features = obj(data)?.features;
  if (!Array.isArray(features)) return [];
  const out: RefugesInfoPlace[] = [];
  for (const f of features) {
    const p = parseRefugesInfoFeature(f);
    if (p) out.push(p);
  }
  return out;
}

export async function fetchRefugesInfoBbox(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<RefugesInfoPlace[]> {
  const url =
    `${BASE}/bbox?bbox=${west},${south},${east},${north}` +
    `&type_points=all&format=geojson&detail=complet&nb_points=all`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "hmr-companion/0.1" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`refuges.info HTTP ${res.status}`);
  return parseRefugesInfoResponse(await res.json());
}

export function refugesInfoExternalUrl(id: number): string {
  return `https://www.refuges.info/point/${id}`;
}

/** Tipo refuges.info → kind/gruppo outdoor (null = da non importare come punto autonomo). */
export function refugesInfoKind(typeId: number | null): { kind: string; grp: string } | null {
  switch (typeId) {
    case 10:
      return { kind: "alpine_hut", grp: "shelter" };
    case 7:
      return { kind: "wilderness_hut", grp: "shelter" };
    case 9:
      return { kind: "refuges_info", grp: "shelter" };
    case 29:
      return { kind: "shelter", grp: "shelter" };
    case 23:
      return { kind: "spring", grp: "water" };
    default:
      return null;
  }
}

/** Gruppi OSM compatibili con un tipo refuges.info per il collegamento per prossimità. */
export function refugesInfoMatchGroups(typeId: number | null): string[] {
  return typeId === 23 ? ["water"] : ["shelter"];
}

const STATE_IT: Record<string, string> = {
  "Détruite": "Distrutto",
  "Détruit": "Distrutto",
  "Inutilisable": "Inutilizzabile",
  "Fermée": "Chiuso",
  "Fermé": "Chiuso",
  "Fermé au public": "Chiuso al pubblico",
  "Ouverture sur contact préalable": "Apertura su contatto preventivo",
  "Clés à récupérer": "Chiavi da ritirare",
  "Tari définitivement": "Prosciugato",
  "Débit intermittent": "Portata intermittente",
};

const TYPE_IT: Record<number, string> = {
  7: "Bivacco / capanna non custodita",
  9: "Posto tappa",
  10: "Rifugio custodito",
  23: "Punto acqua",
  29: "Riparo naturale",
  3: "Passaggio delicato",
  28: "Edificio da verificare",
};

export type RefugesInfoSummary = {
  id: number;
  url: string;
  type: string;
  state: string | null;
  facts: Array<{ label: string; value: string }>;
  /** Testi originali (in genere in francese). */
  access: string | null;
  remark: string | null;
  updatedAt: string | null;
  attribution: string;
};

/** Ripulisce il markup BBCode di refuges.info ([url=…]testo[/url], [->123], [b]…) e limita la lunghezza. */
export function cleanRefugesInfoText(raw: string | null | undefined, max = 600): string | null {
  if (!raw) return null;
  const t = raw
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1")
    .replace(/\[->\s*(\d+)\s*\]/g, "punto refuges.info $1")
    .replace(/\[\/?[a-z*]+(=[^\]]*)?\]/gi, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function triIt(v: TriState): string | null {
  return v === true ? "Sì" : v === false ? "No" : null;
}

/** Riepilogo in italiano per la scheda feature. Accetta anche payload legacy/parziali. */
export function summarizeRefugesInfo(payload: unknown): RefugesInfoSummary | null {
  const p = obj(payload) as Partial<RefugesInfoPlace> | null;
  if (!p || typeof p.id !== "number") return null;
  const facts: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: string | null) => {
    if (value) facts.push({ label, value });
  };
  add("Posti letto", p.places != null && p.places > 0 ? String(p.places) : p.places === 0 ? "Nessuno" : null);
  add("Posti su materasso", p.placesMattress ? String(p.placesMattress) : null);
  add("Acqua entro 100 m", triIt(p.water ?? null));
  add("Stufa", triIt(p.stove ?? null));
  add("Camino", triIt(p.fireplace ?? null));
  add("Coperte", triIt(p.blankets ?? null));
  add("Latrine", triIt(p.latrines ?? null));
  add("Legna entro 100 m", triIt(p.wood ?? null));
  if (p.missingWall === true) add("Manca una parete", "Sì");
  add("Proprietario / info", cleanRefugesInfoText(p.owner, 200));
  const state = p.state ? (STATE_IT[p.state] ?? p.state) : null;
  return {
    id: p.id,
    url: p.url ?? refugesInfoExternalUrl(p.id),
    type: (p.typeId != null ? TYPE_IT[p.typeId] : undefined) ?? p.typeLabel ?? "",
    state,
    facts,
    access: cleanRefugesInfoText(p.access),
    remark: cleanRefugesInfoText(p.remark),
    updatedAt: p.updatedAt ? p.updatedAt.slice(0, 10) : null,
    attribution: REFUGES_INFO_ATTRIBUTION,
  };
}
