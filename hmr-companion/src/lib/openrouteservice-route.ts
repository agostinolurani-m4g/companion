import type { Feature, LineString } from "geojson";
import type { UserRouteActivity } from "@/lib/db";
import {
  lineLengthKm,
} from "@/lib/osrm-route";
import {
  mergeRouteTechParts,
  parseOrsExtras,
  type OrsExtrasRaw,
  type RouteTech,
} from "@/lib/ors-route-tech";

export type OrsProfile =
  | "cycling-road"
  | "cycling-regular"
  | "cycling-mountain"
  | "cycling-electric"
  | "foot-hiking"
  | "foot-walking";

/** Preferenza di percorso scelta dall'utente nel planner. */
export type RoutePreference = "recommended" | "shortest" | "quiet";

export const ROUTE_PREFERENCES: readonly RoutePreference[] = ["recommended", "shortest", "quiet"];

export function isRoutePreference(v: unknown): v is RoutePreference {
  return typeof v === "string" && (ROUTE_PREFERENCES as readonly string[]).includes(v);
}

export type OrsRouteMeta = {
  mode: "single_request" | "chained_segments";
  profileUsed: OrsProfile;
};

/**
 * Profilo ORS per sport. Il gravel/bikepacking usa "cycling-regular" (ammette sterrato e
 * privilegia la rete ciclabile); "cycling-road" evita lo sterrato ed è solo per la bici da strada.
 */
export function activityToOrsProfile(activity: UserRouteActivity): OrsProfile {
  switch (activity) {
    case "road":
      return "cycling-road";
    case "gravel":
    case "bikepacking":
      return "cycling-regular";
    case "mtb":
      return "cycling-mountain";
    case "ebike":
      return "cycling-electric";
    case "walk":
    case "run":
      return "foot-walking";
    default:
      return "foot-hiking";
  }
}

export function activityPrefersOrs(_activity: UserRouteActivity): boolean {
  return true;
}

function isCycling(profile: OrsProfile): boolean {
  return profile.startsWith("cycling");
}

/** Raggio massimo (m) entro cui ORS cerca una via per ogni tappa. */
export const ORS_SNAP_RADIUS_M = 1000;

/** Corpo richiesta ORS: preferenza, ostacoli da evitare, pesi "tranquillo/verde". */
export function buildOrsRequestBody(
  coordinates: [number, number][],
  profile: OrsProfile,
  preference: RoutePreference,
  withOptions = true,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    coordinates,
    preference: preference === "shortest" ? "shortest" : "recommended",
    instructions: false,
    extra_info: ["surface", "waytype", "steepness", "traildifficulty", "waycategory"],
    // Aggancio al sentiero più vicino entro questo raggio (default ORS 350 m: un punto
    // rilasciato nel bosco faceva fallire tutto il percorso).
    radiuses: coordinates.map(() => ORS_SNAP_RADIUS_M),
  };
  if (!withOptions) return body;

  const avoid: string[] = ["ferries"];
  if (isCycling(profile)) avoid.push("steps");
  if (profile === "cycling-road") avoid.push("fords");
  const options: Record<string, unknown> = { avoid_features: avoid };

  if (preference === "quiet") {
    if (isCycling(profile)) {
      // Meno salite ripide: difficoltà pendenza "facile".
      options.profile_params = { weightings: { steepness_difficulty: 0 } };
    } else {
      // Percorsi nel verde e lontani dal traffico.
      options.profile_params = { weightings: { green: 1, quiet: 1 } };
    }
  }
  body.options = options;
  return body;
}

type OrsExtraValuesRaw = [number, number, number][];

/** Un tratto tra due tappe consecutive, come lo restituisce ORS (cache per tratto). */
export type OrsLeg = {
  coords: [number, number][];
  extras?: OrsExtrasRaw;
};

/** Cache dei tratti (lato server: geo_cache SQLite). */
export type OrsLegCache = {
  get: (key: string) => OrsLeg | null;
  set: (key: string, leg: OrsLeg) => void;
};

type OrsRawResult = { coords: [number, number][]; extras?: OrsExtrasRaw; wayPoints?: number[] };

function featureCollectionToRaw(j: GeoJSON.FeatureCollection): OrsRawResult | null {
  const feat = j.features?.[0];
  const g = feat?.geometry;
  if (!g) return null;
  const props = (feat.properties ?? {}) as { extras?: OrsExtrasRaw; way_points?: number[] };
  let coords: [number, number][] = [];
  if (g.type === "LineString" && Array.isArray(g.coordinates)) {
    coords = g.coordinates.map((c) => [c[0], c[1]] as [number, number]);
  } else if (g.type === "MultiLineString" && Array.isArray(g.coordinates)) {
    for (const line of g.coordinates) for (const c of line) coords.push([c[0], c[1]]);
  }
  if (coords.length < 2) return null;
  return { coords, extras: props.extras, wayPoints: Array.isArray(props.way_points) ? props.way_points : undefined };
}

type OrsAttempt = { ok: true; result: OrsRawResult } | { ok: false; optionsRejected: boolean };

async function fetchOrsRaw(profile: OrsProfile, apiKey: string, body: Record<string, unknown>): Promise<OrsAttempt> {
  try {
    const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/geo+json, application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      next: { revalidate: 0 },
    });
    const j = (await res.json()) as { error?: { code?: number; message?: string }; type?: string };
    if (!res.ok || j.error) {
      const msg = j.error?.message ?? "";
      if (msg) console.warn(`[ors] ${profile}: ${msg}`);
      // Riprovare senza opzioni serve solo se ORS ha rifiutato i parametri, non se
      // manca un sentiero vicino a una tappa (2010) o la distanza è eccessiva (2004).
      const code = j.error?.code ?? 0;
      const optionsRejected = code === 2003 || /option|param|weighting|avoid/i.test(msg);
      return { ok: false, optionsRejected };
    }
    if (j.type !== "FeatureCollection" || !("features" in j)) return { ok: false, optionsRejected: false };
    const result = featureCollectionToRaw(j as GeoJSON.FeatureCollection);
    return result ? { ok: true, result } : { ok: false, optionsRejected: false };
  } catch {
    return { ok: false, optionsRejected: false };
  }
}

/** Una richiesta; se ORS rifiuta le opzioni avanzate, riprova senza. */
async function fetchOrsOnce(
  coordinates: [number, number][],
  profile: OrsProfile,
  apiKey: string,
  preference: RoutePreference,
): Promise<OrsRawResult | null> {
  if (coordinates.length < 2) return null;
  const full = await fetchOrsRaw(profile, apiKey, buildOrsRequestBody(coordinates, profile, preference, true));
  if (full.ok) return full.result;
  if (!full.optionsRejected) return null;
  const plain = await fetchOrsRaw(profile, apiKey, buildOrsRequestBody(coordinates, profile, preference, false));
  return plain.ok ? plain.result : null;
}

/** Ritaglia gli extra ORS (intervalli di indici sul tracciato) al tratto [a, b], reindicizzati da 0. */
export function sliceOrsExtras(extras: OrsExtrasRaw | undefined, a: number, b: number): OrsExtrasRaw | undefined {
  if (!extras) return undefined;
  const out: OrsExtrasRaw = {};
  for (const key of Object.keys(extras) as (keyof OrsExtrasRaw)[]) {
    const vals = (extras[key]?.values ?? []) as unknown as OrsExtraValuesRaw;
    const sliced: OrsExtraValuesRaw = [];
    for (const [from, to, v] of vals) {
      if (to <= a || from >= b) continue;
      sliced.push([Math.max(from, a) - a, Math.min(to, b) - a, v]);
    }
    (out as Record<string, unknown>)[key] = { values: sliced };
  }
  return out;
}

/** Divide un percorso ORS multi-tappa nei suoi tratti usando `way_points`. */
export function splitOrsIntoLegs(raw: OrsRawResult, nPoints: number): OrsLeg[] | null {
  const wp = raw.wayPoints;
  if (!wp || wp.length !== nPoints) return null;
  const legs: OrsLeg[] = [];
  for (let i = 0; i < nPoints - 1; i++) {
    const a = wp[i]!;
    const b = wp[i + 1]!;
    if (b < a) return null;
    const coords = raw.coords.slice(a, b + 1);
    // Due tappe agganciate allo stesso punto: tratto nullo ma valido.
    legs.push({ coords: coords.length >= 2 ? coords : [raw.coords[a]!, raw.coords[a]!], extras: sliceOrsExtras(raw.extras, a, b) });
  }
  return legs;
}

/** Bici da strada con "preferisci ciclabili": quota massima di sterrato (0–1) accettata sul tratto. */
export const ROAD_MAX_UNPAVED = 0.02;
/** …e allungamento massimo rispetto al percorso su strada. */
export const ROAD_MAX_DETOUR = 1.25;

/** Codici superficie ORS non asfaltati: unpaved, ghiaia, terra, sabbia, erba… */
const ORS_UNPAVED_SURFACES = new Set([2, 8, 9, 10, 11, 12, 15, 16, 17, 18]);
const ORS_WAYTYPE_TRACK = 5;
const ORS_WAYTYPE_CYCLEWAY = 6;

/** km del tratto coperti dagli intervalli [from, to, valore] che soddisfano `match`. */
function extraKm(
  coords: [number, number][],
  values: [number, number, number][] | undefined,
  match: (v: number, from: number, to: number) => boolean,
): number {
  let km = 0;
  for (const [from, to, v] of values ?? []) {
    if (match(v, from, to)) km += lineLengthKm(coords.slice(from, to + 1));
  }
  return km;
}

/**
 * Quote di sterrato e ciclabile dai codici grezzi ORS. Non usa la superficie "di
 * riepilogo" (che conta ogni marciapiede/footway come sentiero anche se asfaltato).
 */
function legStats(leg: OrsLeg): { km: number; unpaved: number; cycleway: number } {
  const km = lineLengthKm(leg.coords);
  if (km <= 0) return { km, unpaved: 0, cycleway: 0 };
  const surf = leg.extras?.surface?.values;
  const wt = leg.extras?.waytype?.values;
  // Sterrato: superficie dichiarata non asfaltata, oppure carrareccia senza superficie nota.
  const surfAt = (i: number) => surf?.find(([f, t]) => i >= f && i < t)?.[2] ?? 0;
  const unpavedKm =
    extraKm(leg.coords, surf, (v) => ORS_UNPAVED_SURFACES.has(v)) +
    extraKm(leg.coords, wt, (v, from) => v === ORS_WAYTYPE_TRACK && surfAt(from) === 0);
  const cycleKm = extraKm(leg.coords, wt, (v) => v === ORS_WAYTYPE_CYCLEWAY);
  return { km, unpaved: unpavedKm / km, cycleway: cycleKm / km };
}

/**
 * Sceglie, per un tratto, tra il percorso "cycling-road" e quello "cycling-regular"
 * (che privilegia le ciclabili): quest'ultimo solo se resta asfaltato, non allunga
 * troppo e usa davvero più ciclabile.
 */
export function pickRoadLeg(roadLeg: OrsLeg, regularLeg: OrsLeg | null | undefined): OrsLeg {
  if (!regularLeg || regularLeg.coords.length < 2) return roadLeg;
  const r = legStats(roadLeg);
  const c = legStats(regularLeg);
  if (c.unpaved > ROAD_MAX_UNPAVED) return roadLeg;
  if (r.km > 0 && c.km > r.km * ROAD_MAX_DETOUR) return roadLeg;
  if (c.cycleway <= r.cycleway) return roadLeg;
  return regularLeg;
}

function splitRun(raw: OrsRawResult | null, nPoints: number): OrsLeg[] | null {
  if (!raw) return null;
  return nPoints === 2 ? [{ coords: raw.coords, extras: raw.extras }] : splitOrsIntoLegs(raw, nPoints);
}

function legCacheKey(profile: string, preference: RoutePreference, a: [number, number], b: [number, number]): string {
  const r = (c: [number, number]) => `${Math.round(c[0] * 1e5)}_${Math.round(c[1] * 1e5)}`;
  return `orsleg:v1:${profile}:${preference}:${r(a)};${r(b)}`;
}

/** Tratti consecutivi mancanti dalla cache: [primo tratto, ultimo tratto]. */
function missingRuns(have: (OrsLeg | null)[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= have.length; i++) {
    const missing = i < have.length && !have[i];
    if (missing && start < 0) start = i;
    if (!missing && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

/**
 * Percorso ORS calcolato per tratti, con cache per tratto: spostando una tappa si
 * ricalcolano solo i due tratti toccati; i tratti mancanti consecutivi partono in una
 * richiesta sola e i gruppi separati in parallelo.
 * `snapped`: dove ORS ha agganciato ogni tappa al sentiero.
 */
export async function fetchOrsRouteLine(
  coordinates: [number, number][],
  activity: UserRouteActivity,
  apiKey: string,
  preference: RoutePreference = "recommended",
  cache?: OrsLegCache,
  opts: { preferCycleways?: boolean } = {},
): Promise<{
  feature: Feature<LineString>;
  meta: OrsRouteMeta;
  tech: RouteTech | null;
  snapped: [number, number][];
} | null> {
  if (coordinates.length < 2) return null;
  const profile = activityToOrsProfile(activity);
  const nLegs = coordinates.length - 1;
  const mixCycleways = !!opts.preferCycleways && profile === "cycling-road";
  const cacheProfile = mixCycleways ? "road-cycleways-v2" : profile;
  const keys = Array.from({ length: nLegs }, (_, i) =>
    legCacheKey(cacheProfile, preference, coordinates[i]!, coordinates[i + 1]!),
  );
  const legs: (OrsLeg | null)[] = keys.map((k) => cache?.get(k) ?? null);

  const runs = missingRuns(legs);
  const results = await Promise.all(
    runs.map(async ([from, to]) => {
      const pts = coordinates.slice(from, to + 2);
      let split: OrsLeg[] | null;
      if (mixCycleways) {
        const [roadRaw, regularRaw] = await Promise.all([
          fetchOrsOnce(pts, "cycling-road", apiKey, preference),
          fetchOrsOnce(pts, "cycling-regular", apiKey, preference),
        ]);
        const road = splitRun(roadRaw, pts.length);
        const regular = splitRun(regularRaw, pts.length);
        split = road ? road.map((leg, j) => pickRoadLeg(leg, regular?.[j])) : null;
      } else {
        split = splitRun(await fetchOrsOnce(pts, profile, apiKey, preference), pts.length);
      }
      if (!split) return false;
      split.forEach((leg, j) => {
        legs[from + j] = leg;
        cache?.set(keys[from + j]!, leg);
      });
      return true;
    }),
  );
  if (results.some((ok) => !ok) || legs.some((l) => !l)) return null;

  const merged: [number, number][] = [];
  const techParts: RouteTech[] = [];
  const snapped: [number, number][] = [];
  let kmOffset = 0;
  for (const leg of legs as OrsLeg[]) {
    if (snapped.length === 0) snapped.push(leg.coords[0]!);
    snapped.push(leg.coords[leg.coords.length - 1]!);
    techParts.push(parseOrsExtras(leg.coords, leg.extras, kmOffset));
    kmOffset += lineLengthKm(leg.coords);
    const first = leg.coords[0]!;
    const last = merged[merged.length - 1];
    const dup = last && last[0] === first[0] && last[1] === first[1];
    merged.push(...(dup ? leg.coords.slice(1) : leg.coords));
  }
  if (merged.length < 2) return null;

  return {
    feature: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: merged } },
    meta: { mode: nLegs === 1 || runs.length <= 1 ? "single_request" : "chained_segments", profileUsed: profile },
    tech: mergeRouteTechParts(techParts),
    snapped,
  };
}
