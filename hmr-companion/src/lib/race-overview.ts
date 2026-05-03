/**
 * Overview testuale gara: fallback deterministico + (opzionale) Claude Haiku.
 */

import type { RoadbookChunk } from "@/lib/roadbook-chunk";

export type OverviewSource = "template" | "llm";

export type RaceOverviewResult = {
  text_it: string;
  source: OverviewSource;
};

/** Bullet e paragrafo senza LLM — sempre coerente con i chunk. */
export function overviewFromChunksDeterministic(chunks: RoadbookChunk[]): {
  bullets_it: string[];
  paragraph_it: string;
} {
  const bullets: string[] = [];
  for (const ch of chunks) {
    const label = `km ${ch.km_start.toFixed(0)}–${ch.km_end.toFixed(0)}`;
    bullets.push(`${label}: ${ch.one_liner_it}`);
  }
  if (chunks.length === 0) {
    return {
      bullets_it: [],
      paragraph_it: "Nessun dato roadbook disponibile.",
    };
  }
  const first = chunks[0]!;
  const rest = chunks.slice(1);
  let p = `Subito avanti (${first.km_start.toFixed(0)}–${first.km_end.toFixed(0)} km): ${first.one_liner_it}.`;
  if (rest.length > 0) {
    const rough = rest
      .map((c) => {
        const dom =
          c.surface_pct.asphalt >= c.surface_pct.gravel && c.surface_pct.asphalt >= c.surface_pct.single
            ? "più asfalto"
            : c.surface_pct.single >= c.surface_pct.gravel
              ? "più sentiero"
              : "più sterrato";
        return `${c.km_start.toFixed(0)}–${c.km_end.toFixed(0)} km (${dom}${c.steep_unpaved ? ", attenzione pendenza" : ""})`;
      })
      .join("; ");
    p += ` Più avanti: ${rough}.`;
  }
  return { bullets_it: bullets, paragraph_it: p };
}

const DEFAULT_OVERVIEW_MODEL = "claude-3-5-haiku-20241022";

function getOverviewModel(): string {
  return (
    process.env.HMR_OVERVIEW_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    DEFAULT_OVERVIEW_MODEL
  );
}

export async function overviewFromAnthropic(chunks: RoadbookChunk[]): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const payload = chunks.map((c) => ({
    km: `${c.km_start}-${c.km_end}`,
    surface_pct: c.surface_pct,
    elev_min_m: c.elev_min_m,
    steep_unpaved: c.steep_unpaved,
    hike_a_bike: c.hike_a_bike_hint,
    food: c.count_food > 0 || c.has_official_resupply,
    water: c.count_water > 0,
    one_liner: c.one_liner_it,
  }));

  const system = `Sei un assistente per ciclisti in ultra/gara. Rispondi SOLO in italiano con 3-6 frasi brevi e operative.
REGOLE: Usa esclusivamente i dati nel JSON; non inventare luoghi, negozi o strade. Non dare consigli medici. Se mancano dati, dillo.`;

  const user = `Riassumi cosa aspettarsi nei prossimi tratti (ordine temporale lungo la gara). Enfatizza superficie, quota minima se presente, acqua/ristoro, hike-a-bike o pendenza sterrata se true.

\`\`\`json
${JSON.stringify(payload, null, 0)}
\`\`\``;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: getOverviewModel(),
      max_tokens: 400,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (block && block.type === "text") return block.text.trim();
  } catch (e) {
    console.warn("race-overview Anthropic", e);
  }
  return null;
}

/** Cache in-memory per processo (chiave compatta). */
const overviewCache = new Map<string, { text: string; at: number }>();
const OVERVIEW_TTL_MS = 5 * 60 * 1000;

export function overviewCacheKey(trackId: string, startChunkIndex: number, nChunks: number): string {
  return `${trackId}:${startChunkIndex}:${nChunks}`;
}

export function getCachedOverview(key: string): string | null {
  const row = overviewCache.get(key);
  if (!row) return null;
  if (Date.now() - row.at > OVERVIEW_TTL_MS) {
    overviewCache.delete(key);
    return null;
  }
  return row.text;
}

export function setCachedOverview(key: string, text: string): void {
  overviewCache.set(key, { text, at: Date.now() });
}

export async function buildRaceOverview(
  chunks: RoadbookChunk[],
  opts: { useLlm?: boolean; cacheKey?: string }
): Promise<RaceOverviewResult> {
  const det = overviewFromChunksDeterministic(chunks);

  if (opts.useLlm && opts.cacheKey) {
    const hit = getCachedOverview(opts.cacheKey);
    if (hit) return { text_it: hit, source: "llm" };
  }

  if (opts.useLlm && chunks.length > 0) {
    const llm = await overviewFromAnthropic(chunks);
    if (llm) {
      if (opts.cacheKey) setCachedOverview(opts.cacheKey, llm);
      return { text_it: llm, source: "llm" };
    }
  }

  return { text_it: det.paragraph_it, source: "template" };
}
