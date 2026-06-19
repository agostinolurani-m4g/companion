/**
 * Riassunto POI: fallback deterministico + (opzionale) Claude Haiku.
 */

import type { PoiCategory } from "@/lib/db";
import { CATEGORY_META } from "@/lib/categories";

export type PoiSummarySource = "template" | "llm";

export type PoiSummaryResult = {
  text_it: string;
  source: PoiSummarySource;
};

export type PoiSummaryInput = {
  name: string | null;
  category: PoiCategory;
  sub_kind: string;
  description?: string | null;
  extract?: string | null;
  opening_hours?: string | null;
  phone?: string | null;
  website?: string | null;
};

const DEFAULT_MODEL = "claude-3-5-haiku-20241022";

function getModel(): string {
  return (
    process.env.HMR_POI_SUMMARY_MODEL?.trim() ||
    process.env.HMR_OVERVIEW_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    DEFAULT_MODEL
  );
}

export function poiSummaryDeterministic(input: PoiSummaryInput): string {
  const catLabel = CATEGORY_META[input.category]?.label ?? input.category;
  const label = input.name ?? input.sub_kind ?? "POI";
  const parts: string[] = [`${label} (${catLabel}).`];

  const desc = input.extract?.trim() || input.description?.trim();
  if (desc) {
    const short = desc.length > 280 ? `${desc.slice(0, 277)}…` : desc;
    parts.push(short);
  }

  if (input.opening_hours) parts.push(`Orari: ${input.opening_hours}.`);
  if (input.phone) parts.push(`Telefono disponibile.`);
  if (input.website) parts.push(`Sito web indicato.`);

  if (parts.length === 1) {
    parts.push("Punto di interesse segnalato su OpenStreetMap; verifica sul posto orari e disponibilità.");
  }

  return parts.join(" ");
}

export async function poiSummaryFromAnthropic(input: PoiSummaryInput): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const payload = {
    name: input.name,
    category: CATEGORY_META[input.category]?.label ?? input.category,
    sub_kind: input.sub_kind,
    description: input.description,
    wikipedia_extract: input.extract,
    opening_hours: input.opening_hours,
    has_phone: Boolean(input.phone),
    has_website: Boolean(input.website),
  };

  const system = `Sei un assistente per escursionisti e ciclisti. Rispondi SOLO in italiano con 2-4 frasi brevi e utili.
REGOLE: Usa esclusivamente i dati nel JSON; non inventare servizi o orari. Non dare consigli medici. Se mancano dati, dillo brevemente.`;

  const user = `Scrivi un riassunto pratico di questo punto di interesse per chi pianifica un percorso outdoor.

\`\`\`json
${JSON.stringify(payload, null, 0)}
\`\`\``;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: getModel(),
      max_tokens: 220,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (block && block.type === "text") return block.text.trim();
  } catch (e) {
    console.warn("poi-summary Anthropic", e);
  }
  return null;
}

const summaryCache = new Map<string, { text: string; at: number }>();
const SUMMARY_TTL_MS = 10 * 60 * 1000;

export function poiSummaryCacheKey(poiId: string): string {
  return `poi_sum:${poiId}`;
}

function getCached(key: string): string | null {
  const row = summaryCache.get(key);
  if (!row) return null;
  if (Date.now() - row.at > SUMMARY_TTL_MS) {
    summaryCache.delete(key);
    return null;
  }
  return row.text;
}

function setCached(key: string, text: string): void {
  summaryCache.set(key, { text, at: Date.now() });
}

export async function buildPoiSummary(
  poiId: string,
  input: PoiSummaryInput,
  opts: { useLlm?: boolean } = {}
): Promise<PoiSummaryResult> {
  const cacheKey = poiSummaryCacheKey(poiId);
  if (opts.useLlm) {
    const hit = getCached(cacheKey);
    if (hit) return { text_it: hit, source: "llm" };
  }

  if (opts.useLlm) {
    const llm = await poiSummaryFromAnthropic(input);
    if (llm) {
      setCached(cacheKey, llm);
      return { text_it: llm, source: "llm" };
    }
  }

  return { text_it: poiSummaryDeterministic(input), source: "template" };
}
