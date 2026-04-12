export async function duckDuckGoSearch(query: string): Promise<{
  query: string;
  abstract: string | null;
  abstract_url: string | null;
  heading: string | null;
  related: { text: string; url: string | null }[];
}> {
  const q = query.trim();
  if (!q) throw new Error("query vuota");
  const u = new URL("https://api.duckduckgo.com/");
  u.searchParams.set("q", q);
  u.searchParams.set("format", "json");
  u.searchParams.set("no_html", "1");
  u.searchParams.set("skip_disambig", "1");
  const res = await fetch(u.toString(), {
    headers: { "User-Agent": "TrailPlannerLocal/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const data = (await res.json()) as {
    Abstract?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: unknown[];
  };
  const related: { text: string; url: string | null }[] = [];
  const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  for (const item of topics.slice(0, 12)) {
    if (typeof item === "object" && item !== null && "Text" in item) {
      const t = item as { Text?: string; FirstURL?: string };
      if (t.Text) related.push({ text: String(t.Text), url: t.FirstURL ?? null });
    }
  }
  return {
    query: q,
    abstract: data.Abstract ?? null,
    abstract_url: data.AbstractURL ?? null,
    heading: data.Heading ?? null,
    related,
  };
}
