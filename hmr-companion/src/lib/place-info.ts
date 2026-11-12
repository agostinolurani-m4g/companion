/**
 * Info su un luogo qualsiasi (vetta, paese, rifugio, lago…) partendo da nome + coordinate:
 * voce Wikipedia trovata per nome vicino al punto, foto dell'articolo e foto Commons georeferenziate.
 */

import { geoCacheGet, geoCacheSet } from "@/lib/db";

const UA = { "user-agent": "hmr-companion/0.1" };

export type WikiByNameResult = {
  title: string;
  lang: string;
  extract: string | null;
  image: string | null;
  wiki_url: string;
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type SearchPage = {
  title: string;
  index?: number;
  extract?: string;
  coordinates?: Array<{ lat: number; lon: number }>;
  thumbnail?: { source?: string };
  fullurl?: string;
  pageprops?: { wikibase_item?: string; disambiguation?: string };
};

/** Coordinate (P625) da Wikidata per più entità in una chiamata. */
async function wikidataCoords(ids: string[]): Promise<Map<string, { lat: number; lon: number }>> {
  const out = new Map<string, { lat: number; lon: number }>();
  if (ids.length === 0) return out;
  const u = new URL("https://www.wikidata.org/w/api.php");
  u.searchParams.set("action", "wbgetentities");
  u.searchParams.set("format", "json");
  u.searchParams.set("ids", ids.slice(0, 50).join("|"));
  u.searchParams.set("props", "claims");
  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(12_000), headers: UA });
  if (!res.ok) return out;
  const data = (await res.json()) as {
    entities?: Record<
      string,
      { claims?: { P625?: Array<{ mainsnak?: { datavalue?: { value?: { latitude: number; longitude: number } } } }> } }
    >;
  };
  for (const [id, ent] of Object.entries(data.entities ?? {})) {
    const v = ent.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    if (v) out.set(id, { lat: v.latitude, lon: v.longitude });
  }
  return out;
}

async function searchWiki(lang: string, name: string, lat: number, lng: number, maxKm: number) {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("generator", "search");
  u.searchParams.set("gsrsearch", name);
  u.searchParams.set("gsrlimit", "8");
  u.searchParams.set("prop", "coordinates|pageimages|extracts|info|pageprops");
  u.searchParams.set("ppprop", "wikibase_item|disambiguation");
  u.searchParams.set("inprop", "url");
  u.searchParams.set("colimit", "max");
  u.searchParams.set("piprop", "thumbnail");
  u.searchParams.set("pithumbsize", "800");
  u.searchParams.set("pilimit", "max");
  u.searchParams.set("exintro", "1");
  u.searchParams.set("explaintext", "1");
  u.searchParams.set("exsentences", "5");
  u.searchParams.set("exlimit", "max");

  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(12_000), headers: UA });
  if (!res.ok) return null;
  const data = (await res.json()) as { query?: { pages?: Record<string, SearchPage> } };
  const pages = Object.values(data.query?.pages ?? {})
    .filter((p) => !p.pageprops?.disambiguation)
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  const target = norm(name);
  const titleMatches = (p: SearchPage) => norm(p.title) === target || norm(p.title).startsWith(`${target} `);

  // Voci senza coordinate su Wikipedia (es. massicci): le coordinate le prende da Wikidata.
  // Un titolo uguale senza posizione verificabile NON basta (es. "Tanno" paese vs colore).
  const needWd = pages.filter((p) => !p.coordinates?.[0] && titleMatches(p) && p.pageprops?.wikibase_item);
  const wd = await wikidataCoords(needWd.map((p) => p.pageprops!.wikibase_item!)).catch(() => new Map());

  let best: { page: SearchPage; score: number } | null = null;
  for (const p of pages) {
    const c = p.coordinates?.[0] ?? (p.pageprops?.wikibase_item ? wd.get(p.pageprops.wikibase_item) : undefined);
    if (!c) continue;
    const dist = haversineKm(lat, lng, c.lat, c.lon);
    if (dist > maxKm) continue;
    const score = (titleMatches(p) ? 0 : 10) + dist / maxKm + (p.index ?? 0) * 0.2;
    if (!best || score < best.score) best = { page: p, score };
  }
  if (!best) return null;
  const p = best.page;
  return {
    title: p.title,
    lang,
    extract: p.extract?.trim() || null,
    image: p.thumbnail?.source ?? null,
    wiki_url: p.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
  } satisfies WikiByNameResult;
}

/** Trova la voce Wikipedia (it, poi en) che corrisponde a un nome vicino a un punto. */
export async function findWikipediaByName(opts: {
  name: string;
  lat: number;
  lng: number;
  maxKm?: number;
}): Promise<WikiByNameResult | null> {
  const name = opts.name.trim();
  if (name.length < 2) return null;
  const maxKm = opts.maxKm ?? 20;
  const cacheKey = `wiki_name2:${norm(name)}:${opts.lat.toFixed(2)}:${opts.lng.toFixed(2)}`;
  const cached = geoCacheGet(cacheKey);
  if (cached && typeof cached === "object") {
    const c = cached as { hit: WikiByNameResult | null };
    if ("hit" in c) return c.hit;
  }
  let hit: WikiByNameResult | null = null;
  for (const lang of ["it", "en"]) {
    try {
      hit = await searchWiki(lang, name, opts.lat, opts.lng, maxKm);
    } catch (e) {
      console.warn("wiki search", lang, e);
    }
    if (hit) break;
  }
  geoCacheSet(cacheKey, { hit });
  return hit;
}

const BAD_FILE = /(icon|logo|flag|bandiera|stemma|coat[_ ]of[_ ]arms|map|mappa|locator|location|karte|carte|commons-|wiki|symbol|pictogram|signature|\.svg$|\.gif$)/i;

type ImageInfoPage = {
  title: string;
  imageinfo?: Array<{ thumburl?: string; url?: string; mime?: string; width?: number; height?: number }>;
};

function goodPhotos(pages: ImageInfoPage[], max: number): string[] {
  const out: string[] = [];
  for (const p of pages) {
    if (BAD_FILE.test(p.title)) continue;
    const ii = p.imageinfo?.[0];
    if (!ii || ii.mime !== "image/jpeg") continue;
    if ((ii.width ?? 0) < 400 || (ii.height ?? 0) < 250) continue;
    const url = ii.thumburl ?? ii.url;
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** Foto (jpeg, niente icone/mappe) usate nella voce Wikipedia. */
export async function wikiArticlePhotos(lang: string, title: string, max = 6): Promise<string[]> {
  const cacheKey = `wiki_imgs:${lang}:${title}`;
  const cached = geoCacheGet(cacheKey);
  if (Array.isArray(cached)) return (cached as string[]).slice(0, max);
  try {
    const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    u.searchParams.set("action", "query");
    u.searchParams.set("format", "json");
    u.searchParams.set("titles", title);
    u.searchParams.set("generator", "images");
    u.searchParams.set("gimlimit", "40");
    u.searchParams.set("prop", "imageinfo");
    u.searchParams.set("iiprop", "url|mime|size");
    u.searchParams.set("iiurlwidth", "800");
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(12_000), headers: UA });
    if (!res.ok) return [];
    const data = (await res.json()) as { query?: { pages?: Record<string, ImageInfoPage> } };
    const photos = goodPhotos(Object.values(data.query?.pages ?? {}), 10);
    geoCacheSet(cacheKey, photos);
    return photos.slice(0, max);
  } catch (e) {
    console.warn("wiki article photos", e);
    return [];
  }
}

/** Foto georeferenziate su Wikimedia Commons attorno a un punto. */
export async function commonsPhotosAround(lat: number, lng: number, radiusM = 2000, max = 6): Promise<string[]> {
  const r = Math.min(10_000, Math.max(200, Math.round(radiusM)));
  const cacheKey = `commons_near:${lat.toFixed(3)}:${lng.toFixed(3)}:${r}`;
  const cached = geoCacheGet(cacheKey);
  if (Array.isArray(cached)) return (cached as string[]).slice(0, max);
  try {
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    u.searchParams.set("action", "query");
    u.searchParams.set("format", "json");
    u.searchParams.set("generator", "geosearch");
    u.searchParams.set("ggsnamespace", "6");
    u.searchParams.set("ggscoord", `${lat}|${lng}`);
    u.searchParams.set("ggsradius", String(r));
    u.searchParams.set("ggslimit", "30");
    u.searchParams.set("prop", "imageinfo");
    u.searchParams.set("iiprop", "url|mime|size");
    u.searchParams.set("iiurlwidth", "800");
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(12_000), headers: UA });
    if (!res.ok) return [];
    const data = (await res.json()) as { query?: { pages?: Record<string, ImageInfoPage & { index?: number }> } };
    const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const photos = goodPhotos(pages, 10);
    geoCacheSet(cacheKey, photos);
    return photos.slice(0, max);
  } catch (e) {
    console.warn("commons near", e);
    return [];
  }
}
