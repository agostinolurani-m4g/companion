/** Foto georeferenziate da Wikimedia Commons (geosearch). */

export type CommonsPhoto = {
  title: string;
  thumbUrl: string;
  pageUrl: string;
};

export async function commonsPhotosNear(lat: number, lng: number, radiusM = 500): Promise<CommonsPhoto[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "geosearch");
  url.searchParams.set("gscoord", `${lat}|${lng}`);
  url.searchParams.set("gsradius", String(Math.min(10_000, Math.max(100, radiusM))));
  url.searchParams.set("gslimit", "8");
  url.searchParams.set("prop", "pageimages");
  url.searchParams.set("piprop", "thumbnail");
  url.searchParams.set("pithumbsize", "320");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: { geosearch?: Array<{ title: string; pageid: number }> };
  };
  const pages = data.query?.geosearch ?? [];
  return pages.map((p) => ({
    title: p.title.replace(/^File:/, ""),
    thumbUrl: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.title.replace(/^File:/, ""))}?width=320`,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
  }));
}
