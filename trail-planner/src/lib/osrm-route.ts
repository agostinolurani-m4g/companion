import type { Feature, LineString } from "geojson";

/**
 * Routing usato da «Traccia su strada»:
 * **OSRM** (Open Source Routing Machine) sul server demo pubblico `router.project-osrm.org`.
 *
 * - Il grafo è quello di **OpenStreetMap** (strade, piste ciclabili, sentieri mappati come ways
 *   percorribili a piedi/bici, ecc.). Non è un DEM né uno “snap” magico: dove OSM non ha un
 *   sentiero, OSRM non può inventarlo.
 * - Con più tappe, OSRM calcola un **unico percorso che le visita nell’ordine** (prima → seconda → …),
 *   scegliendo il percorso ottimale **lungo quel grafo** (tempo/distanza secondo il profilo).
 * - Profili `foot` / `walking` vs `cycling`: grafi diversi (sentieri e pedonale vs rete ciclabile/strade).
 *
 * Limite: servizio demo, uso equo; in montagna molti sentieri possono mancare o il multi-waypoint
 * può fallire: in quel caso proviamo il **routing a coppie** (tappa i → i+1) e uniamo le geometrie.
 */
/** `foot` = pedonale/sentieri OSM (ideale escursionismo); `cycling` = bici; `walking` = variante pedonale. */
export type OsrmProfile = "driving" | "walking" | "cycling" | "foot";

/** Distanza approssimata tra due [lng,lat] in km (sufficiente per spezzare i tratti lunghi). */
function haversineKmLngLat(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function interpolateLngLat(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Inserisce punti intermedi lungo ogni segmento se supera `maxLegKm`.
 * Per **ciclismo** aiuta OSRM a seguire strade principali su tratti lunghi (più vincoli lungo il corridoio).
 * Limite vertici per non superare lunghezze URL del server demo OSRM.
 * Usato anche per **foot** / **walking** su tratti lunghi (stesso problema dei vincoli OSRM).
 */
export function densifyCoordinatesForCycling(
  coordinates: [number, number][],
  maxLegKm = 26,
  maxVertices = 44,
  depth = 0
): [number, number][] {
  if (coordinates.length < 2) return coordinates;
  const out: [number, number][] = [coordinates[0]];
  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = coordinates[i];
    const b = coordinates[i + 1];
    const dist = haversineKmLngLat(a, b);
    if (dist <= maxLegKm) {
      out.push(b);
      continue;
    }
    const nSeg = Math.max(1, Math.ceil(dist / maxLegKm));
    for (let k = 1; k < nSeg; k++) {
      const t = k / nSeg;
      out.push(interpolateLngLat(a, b, t));
    }
    out.push(b);
  }
  if (out.length <= maxVertices) return out;
  if (depth > 5) return coordinates;
  return densifyCoordinatesForCycling(coordinates, maxLegKm * 1.75, maxVertices, depth + 1);
}

export type OsrmRouteMeta = {
  mode: "single_request" | "chained_segments";
  /** Profilo effettivo se si è usato fallback foot → walking. */
  profileUsed: OsrmProfile;
};

function shouldDensifyOsrmLegs(profile: OsrmProfile): boolean {
  return profile === "cycling" || profile === "foot" || profile === "walking";
}

async function fetchOsrmRouteLineOnce(
  coordinates: [number, number][],
  profile: OsrmProfile
): Promise<Feature<LineString> | null> {
  if (coordinates.length < 2) return null;
  const path = coordinates.map((c) => `${c[0]},${c[1]}`).join(";");
  const href = `https://router.project-osrm.org/route/v1/${profile}/${path}?overview=full&geometries=geojson`;
  const res = await fetch(href, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    code?: string;
    routes?: { geometry: { type: string; coordinates: [number, number][] } }[];
  };
  if (j.code !== "Ok" || !j.routes?.[0]?.geometry) return null;
  const g = j.routes[0].geometry;
  if (g.type !== "LineString" || !Array.isArray(g.coordinates)) return null;
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: g.coordinates },
  };
}

/** Unisce più LineString evitando duplicati al giunto. */
function mergeLineCoordinates(segments: [number, number][][]): [number, number][] {
  const out: [number, number][] = [];
  for (const seg of segments) {
    if (seg.length === 0) continue;
    if (out.length === 0) {
      out.push(...seg);
      continue;
    }
    const [a, b] = [out[out.length - 1], seg[0]];
    const dup = a[0] === b[0] && a[1] === b[1];
    out.push(...(dup ? seg.slice(1) : seg));
  }
  return out;
}

/**
 * Prima una richiesta con tutte le tappe in ordine; se fallisce, una richiesta per ogni coppia
 * consecutiva e unione delle geometrie (più robusto con molti punti o grafi incompleti).
 * Se il profilo è **foot** e non c’è percorso, riprova con **walking** (stesso server demo, grafo spesso più denso).
 */
async function fetchOsrmRouteLineForProfile(
  coordinates: [number, number][],
  profile: OsrmProfile
): Promise<{ feature: Feature<LineString>; meta: Omit<OsrmRouteMeta, "profileUsed"> } | null> {
  if (coordinates.length < 2) return null;

  let coords = coordinates;
  if (shouldDensifyOsrmLegs(profile)) {
    coords = densifyCoordinatesForCycling(coordinates);
  }

  const single = await fetchOsrmRouteLineOnce(coords, profile);
  if (single) {
    return { feature: single, meta: { mode: "single_request" } };
  }

  const segmentCoords: [number, number][][] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const leg = await fetchOsrmRouteLineOnce([coords[i], coords[i + 1]], profile);
    if (!leg?.geometry?.coordinates?.length) {
      return null;
    }
    segmentCoords.push(leg.geometry.coordinates as [number, number][]);
  }
  const merged = mergeLineCoordinates(segmentCoords);
  if (merged.length < 2) return null;
  return {
    feature: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: merged },
    },
    meta: { mode: "chained_segments" },
  };
}

export async function fetchOsrmRouteLine(
  coordinates: [number, number][],
  profile: OsrmProfile
): Promise<{ feature: Feature<LineString>; meta: OsrmRouteMeta } | null> {
  const attempt = async (p: OsrmProfile): Promise<{ feature: Feature<LineString>; meta: OsrmRouteMeta } | null> => {
    const r = await fetchOsrmRouteLineForProfile(coordinates, p);
    if (!r) return null;
    return { feature: r.feature, meta: { ...r.meta, profileUsed: p } };
  };

  let out = await attempt(profile);
  if (!out && profile === "foot") {
    out = await attempt("walking");
  }
  return out;
}

/** Normalizza valori eventualmente salvati in modo non standard. */
export function normalizeActivityForRouting(activity: string | undefined | null): string {
  const a = (activity ?? "hiking").toLowerCase().trim();
  if (a === "escursionismo" || a === "trekking" || a === "hike") return "hiking";
  return a;
}

/**
 * Mappa attività itinerario → profilo OSRM sul server demo.
 * Escursionismo / trail / sci → **foot** (sentieri e vie pedonali), non **cycling**.
 */
export function activityToOsrmProfile(activity: string): OsrmProfile {
  const a = normalizeActivityForRouting(activity);
  switch (a) {
    case "road_bike":
    case "gravel":
    case "mtb":
      return "cycling";
    case "hiking":
    case "trail_running":
    case "ski_mountaineering":
    case "nordic_ski":
      return "foot";
    case "running":
      return "walking";
    default:
      return "foot";
  }
}
