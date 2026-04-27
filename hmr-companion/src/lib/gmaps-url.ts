/**
 * Parser per URL Google Maps.
 * Supporta:
 *  - maps.app.goo.gl/XXX  (short URL → HEAD redirect)
 *  - goo.gl/maps/XXX      (legacy short URL)
 *  - www.google.com/maps/place/NAME/@lat,lng,zoomz/data=!...!3dLAT!4dLNG
 *  - www.google.com/maps?q=lat,lng / ?query=lat,lng
 *  - maps.google.com/?q=lat,lng
 *
 * Estrae: lat/lng (richiesto), name (best-effort dal /place/<name>/),
 * e ritorna l'URL finale (utile da salvare per riapertura one-tap).
 */

/** Apre Google Maps con il layer Street View centrato su lat/lng (cbll). */
export function googleMapsStreetViewLayerUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}`;
}

export class GmapsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmapsParseError";
  }
}

export type GmapsParsed = {
  lat: number;
  lng: number;
  name?: string;
  /** URL canonico dopo eventuali redirect di short URL. */
  googleUrl: string;
};

const SHORT_URL_RE =
  /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|app\.goo\.gl)\b/i;

const UA =
  "Mozilla/5.0 (compatible; HmrCompanion/0.1; +https://github.com/) " +
  "Safari/537.36";

/**
 * Segue manualmente fino a `maxHops` redirect (301/302/307/308).
 * Usa GET invece di HEAD perché i short URL di Google a volte
 * non rispondono correttamente al HEAD.
 */
async function resolveRedirects(url: string, maxHops = 4): Promise<string> {
  let current = url;
  const seen = new Set<string>();
  for (let i = 0; i < maxHops; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
        },
      });
    } catch {
      break;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      try {
        current = new URL(loc, current).toString();
      } catch {
        break;
      }
      continue;
    }
    // 200/4xx/5xx: non c'è altro da seguire
    break;
  }
  return current;
}

function parseLatLngFromUrl(
  fullUrl: string
): { lat: number; lng: number; name?: string } | null {
  let lat: number | null = null;
  let lng: number | null = null;
  let name: string | undefined;

  // !3dLAT!4dLNG (la più precisa, deriva dai "data=" della URL)
  const d = fullUrl.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (d) {
    lat = parseFloat(d[1]);
    lng = parseFloat(d[2]);
  }

  // @lat,lng,<zoom>z  (centro mappa, fallback comune)
  if (lat == null || lng == null) {
    const at = fullUrl.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (at) {
      lat = parseFloat(at[1]);
      lng = parseFloat(at[2]);
    }
  }

  // ?q=lat,lng / ?query=lat,lng / ?ll=lat,lng
  try {
    const u = new URL(fullUrl);
    const qParam =
      u.searchParams.get("q") ||
      u.searchParams.get("query") ||
      u.searchParams.get("ll");
    if (qParam) {
      const qm = qParam.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
      if (qm) {
        const pLat = parseFloat(qm[1]);
        const pLng = parseFloat(qm[2]);
        if (lat == null || lng == null) {
          lat = pLat;
          lng = pLng;
        }
      } else if (!name) {
        name = decodeURIComponent(qParam).trim() || undefined;
      }
    }
  } catch {
    /* ignore */
  }

  // /place/NAME/ → nome leggibile
  if (!name) {
    const p = fullUrl.match(/\/place\/([^/@?]+)/);
    if (p) {
      try {
        name = decodeURIComponent(p[1]).replace(/\+/g, " ").trim();
      } catch {
        name = p[1].replace(/\+/g, " ");
      }
    }
  }

  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, name };
}

export async function parseGoogleMapsUrl(rawInput: string): Promise<GmapsParsed> {
  const input = rawInput.trim();
  if (!input) throw new GmapsParseError("URL vuoto");

  // L'utente potrebbe incollare un messaggio con testo attorno
  const urlMatch = input.match(/https?:\/\/\S+/i);
  const candidate = urlMatch ? urlMatch[0] : input;

  // Strippa caratteri di chiusura comuni incollati insieme all'URL
  const cleaned = candidate.replace(/[)\].,;]+$/g, "");

  let url: string;
  try {
    url = new URL(cleaned).toString();
  } catch {
    throw new GmapsParseError("Non sembra un URL valido");
  }

  // Prima proviamo a parsare direttamente (URL lungo già canonico)
  const direct = parseLatLngFromUrl(url);
  if (direct) {
    return { ...direct, googleUrl: url };
  }

  // Altrimenti se è uno short URL, seguiamo i redirect
  if (SHORT_URL_RE.test(url)) {
    const resolved = await resolveRedirects(url);
    const parsed = parseLatLngFromUrl(resolved);
    if (parsed) return { ...parsed, googleUrl: resolved };
    throw new GmapsParseError(
      "Il link è stato seguito ma non conteneva coordinate riconoscibili"
    );
  }

  throw new GmapsParseError(
    "Impossibile estrarre le coordinate da questo URL Google Maps"
  );
}
