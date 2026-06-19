/**
 * Arricchimento POI: Wikipedia/Wikimedia + foto Mapillary vicine.
 */

import { geoCacheGet, geoCacheSet } from "@/lib/db";

export type PoiWikiResult = {
  extract: string | null;
  image: string | null;
  wiki_url: string | null;
};

export type PoiDetailsResult = {
  photos: string[];
  extract: string | null;
  wiki_url: string | null;
};

type MlyImage = {
  id: string;
  thumb_256_url?: string;
  computed_geometry?: { type: "Point"; coordinates: [number, number] };
  geometry?: { type: "Point"; coordinates: [number, number] };
};

function parseWikipediaTag(tag: string): { lang: string; title: string } | null {
  const t = tag.trim();
  if (!t) return null;
  const colon = t.indexOf(":");
  if (colon > 0) {
    return { lang: t.slice(0, colon), title: t.slice(colon + 1) };
  }
  return { lang: "en", title: t };
}

async function wikipediaTitleFromWikidata(wikidataId: string): Promise<{ lang: string; title: string } | null> {
  const q = wikidataId.replace(/^Q/i, "Q");
  const cacheKey = `wikidata_title:${q}`;
  const cached = geoCacheGet(cacheKey);
  if (cached && typeof cached === "object" && cached !== null) {
    const c = cached as { lang?: string; title?: string };
    if (c.lang && c.title) return { lang: c.lang, title: c.title };
  }

  try {
    const res = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(q)}.json`, {
      signal: AbortSignal.timeout(12_000),
      headers: { "user-agent": "hmr-companion/0.1" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      entities?: Record<string, { sitelinks?: Record<string, { title?: string }> }>;
    };
    const entity = data.entities?.[q];
    const sitelinks = entity?.sitelinks ?? {};
    const pref = ["itwiki", "enwiki", "elwiki"];
    for (const site of pref) {
      const title = sitelinks[site]?.title;
      if (title) {
        const lang = site.replace("wiki", "");
        const out = { lang, title };
        geoCacheSet(cacheKey, out);
        return out;
      }
    }
    const first = Object.entries(sitelinks).find(([k]) => k.endsWith("wiki"));
    if (first?.[1]?.title) {
      const lang = first[0].replace("wiki", "");
      const out = { lang, title: first[1].title };
      geoCacheSet(cacheKey, out);
      return out;
    }
  } catch (e) {
    console.warn("wikidata lookup", e);
  }
  return null;
}

export async function fetchWikipediaSummary(opts: {
  wikidata?: string | null;
  wikipedia?: string | null;
}): Promise<PoiWikiResult> {
  let parsed: { lang: string; title: string } | null = null;
  if (opts.wikipedia) parsed = parseWikipediaTag(opts.wikipedia);
  if (!parsed && opts.wikidata) parsed = await wikipediaTitleFromWikidata(opts.wikidata);
  if (!parsed) return { extract: null, image: null, wiki_url: null };

  const cacheKey = `wiki_sum:${parsed.lang}:${parsed.title}`;
  const cached = geoCacheGet(cacheKey);
  if (cached && typeof cached === "object" && cached !== null) {
    const c = cached as PoiWikiResult;
    return c;
  }

  try {
    const titleEnc = encodeURIComponent(parsed.title.replace(/ /g, "_"));
    const res = await fetch(
      `https://${parsed.lang}.wikipedia.org/api/rest_v1/page/summary/${titleEnc}`,
      {
        signal: AbortSignal.timeout(12_000),
        headers: { "user-agent": "hmr-companion/0.1" },
      }
    );
    if (!res.ok) return { extract: null, image: null, wiki_url: null };
    const data = (await res.json()) as {
      extract?: string;
      thumbnail?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
    };
    const result: PoiWikiResult = {
      extract: data.extract?.trim() || null,
      image: data.thumbnail?.source?.trim() || null,
      wiki_url: data.content_urls?.desktop?.page?.trim() || null,
    };
    geoCacheSet(cacheKey, result);
    return result;
  } catch (e) {
    console.warn("wikipedia summary", e);
    return { extract: null, image: null, wiki_url: null };
  }
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchMapillaryNearPoint(opts: {
  lat: number;
  lng: number;
  accessToken: string;
  radiusM?: number;
  maxItems?: number;
}): Promise<string[]> {
  const { lat, lng, accessToken, radiusM = 80, maxItems = 6 } = opts;
  const padDeg = radiusM / 111_320;
  const west = lng - padDeg;
  const east = lng + padDeg;
  const south = lat - padDeg;
  const north = lat + padDeg;
  const cacheKey = `mly_pt:${Math.round(lat * 1e5)}_${Math.round(lng * 1e5)}_${radiusM}`;

  let data: unknown = geoCacheGet(cacheKey);
  if (data == null) {
    const u = new URL("https://graph.mapillary.com/images");
    u.searchParams.set("bbox", `${west},${south},${east},${north}`);
    u.searchParams.set("limit", "40");
    u.searchParams.set("fields", "id,thumb_256_url,computed_geometry,geometry");
    u.searchParams.set("access_token", accessToken);
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    data = await res.json();
    geoCacheSet(cacheKey, data);
  }

  const body = data as { data?: MlyImage[] };
  const rows = Array.isArray(body.data) ? body.data : [];
  const scored: { dist: number; url: string }[] = [];

  for (const im of rows) {
    if (!im?.thumb_256_url) continue;
    const g = im.computed_geometry ?? im.geometry;
    if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
    const [ilng, ilat] = g.coordinates;
    if (!Number.isFinite(ilat) || !Number.isFinite(ilng)) continue;
    const dist = haversineM(lat, lng, ilat, ilng);
    if (dist > radiusM) continue;
    scored.push({ dist, url: im.thumb_256_url });
  }

  scored.sort((a, b) => a.dist - b.dist);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of scored) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s.url);
    if (out.length >= maxItems) break;
  }
  return out;
}

export async function buildPoiDetails(opts: {
  lat: number;
  lng: number;
  osmImage?: string | null;
  wikidata?: string | null;
  wikipedia?: string | null;
  mapillaryToken?: string | null;
}): Promise<PoiDetailsResult> {
  const photos: string[] = [];
  const addPhoto = (url: string | null | undefined) => {
    if (!url || photos.includes(url)) return;
    photos.push(url);
  };

  addPhoto(opts.osmImage);

  const wiki = await fetchWikipediaSummary({
    wikidata: opts.wikidata,
    wikipedia: opts.wikipedia,
  });
  addPhoto(wiki.image);

  if (opts.mapillaryToken) {
    try {
      const mly = await fetchMapillaryNearPoint({
        lat: opts.lat,
        lng: opts.lng,
        accessToken: opts.mapillaryToken,
      });
      for (const u of mly) addPhoto(u);
    } catch (e) {
      console.warn("mapillary near poi", e);
    }
  }

  return {
    photos: photos.slice(0, 12),
    extract: wiki.extract,
    wiki_url: wiki.wiki_url,
  };
}
