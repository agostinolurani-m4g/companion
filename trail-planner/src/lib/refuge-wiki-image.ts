/** Immagine da Wikipedia (it) per nome rifugio / POI — cache HTTP lato fetch Next. */

const UA = "TrailPlanner/1.0 (itinerario; contatto via app locale)";

async function wikiThumb(title: string): Promise<string | null> {
  const url = new URL("https://it.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", title);
  url.searchParams.set("prop", "pageimages");
  url.searchParams.set("format", "json");
  url.searchParams.set("pithumbsize", "480");
  url.searchParams.set("piprop", "thumbnail");
  const r = await fetch(url.toString(), {
    headers: { "User-Agent": UA },
    next: { revalidate: 86400 },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    query?: { pages?: Record<string, { thumbnail?: { source: string }; missing?: boolean }> };
  };
  const pages = j.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || page.missing) return null;
  return page.thumbnail?.source ?? null;
}

/** URL https di un’immagine anteprima, o null. */
export async function fetchWikipediaImageUrlForQuery(q: string): Promise<string | null> {
  const query = q.trim();
  if (!query) return null;

  let img = await wikiThumb(query);
  if (img) return img;

  const url = new URL("https://it.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("srlimit", "3");
  const r = await fetch(url.toString(), {
    headers: { "User-Agent": UA },
    next: { revalidate: 86400 },
  });
  if (r.ok) {
    const j = (await r.json()) as { query?: { search?: Array<{ title: string }> } };
    const hits = j.query?.search ?? [];
    for (const h of hits) {
      img = await wikiThumb(h.title);
      if (img) return img;
    }
  }
  return null;
}
