import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

/** Anteprima immagine da Wikipedia (it) per nome rifugio / POI. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q obbligatorio" }, { status: 400 });

  let img = await wikiThumb(q);
  if (!img) {
    const url = new URL("https://it.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", q);
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
        if (img) break;
      }
    }
  }

  return NextResponse.json({ image_url: img });
}
