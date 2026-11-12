/**
 * Riassunto POI/luogo: fallback deterministico + (opzionale) Claude, orientato allo sport attivo.
 */

import type { PoiCategory } from "@/lib/db";
import { CATEGORY_META } from "@/lib/categories";
import { geoCacheGet, geoCacheSet } from "@/lib/db";

export type PoiSummarySource = "template" | "llm";

export type PoiSummaryResult = {
  text_it: string;
  source: PoiSummarySource;
};

export type PoiSummaryInput = {
  name: string | null;
  /** Categoria POI dell'app; assente per luoghi della mappa (vette, paesi, laghi…). */
  category?: PoiCategory | null;
  sub_kind: string;
  /** Etichetta leggibile del tipo di luogo, es. "Vetta", "Paese". */
  kind_label?: string | null;
  /** Sport attivo, es. "Scialpinismo": orienta il riassunto. */
  sport?: string | null;
  ele?: number | null;
  description?: string | null;
  extract?: string | null;
  opening_hours?: string | null;
  phone?: string | null;
  website?: string | null;
};

const DEFAULT_MODEL = "claude-opus-5-5";

function getModel(): string {
  return (
    process.env.HMR_POI_SUMMARY_MODEL?.trim() ||
    process.env.HMR_OVERVIEW_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    DEFAULT_MODEL
  );
}

export function poiSummaryDeterministic(input: PoiSummaryInput): string {
  const catLabel = kindLabelOf(input);
  const label = input.name ?? input.sub_kind ?? "POI";
  const ele = input.ele != null && Number.isFinite(input.ele) ? `, ${Math.round(input.ele)} m` : "";
  const parts: string[] = [`${label} (${catLabel}${ele}).`];

  const desc = input.extract?.trim() || input.description?.trim();
  if (desc) {
    const short = desc.length > 280 ? `${desc.slice(0, 277)}…` : desc;
    parts.push(short);
  }

  if (input.opening_hours) parts.push(`Orari: ${input.opening_hours}.`);
  if (input.phone) parts.push(`Telefono disponibile.`);
  if (input.website) parts.push(`Sito web indicato.`);

  if (parts.length === 1) {
    parts.push(
      input.category
        ? "Punto di interesse segnalato su OpenStreetMap; verifica sul posto orari e disponibilità."
        : "Nessuna descrizione disponibile: prova la ricerca Google qui sotto.",
    );
  }

  return parts.join(" ");
}

function kindLabelOf(input: PoiSummaryInput): string {
  if (input.kind_label?.trim()) return input.kind_label.trim();
  if (input.category) return CATEGORY_META[input.category]?.label ?? input.category;
  return input.sub_kind;
}

export async function poiSummaryFromAnthropic(input: PoiSummaryInput): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const payload = {
    name: input.name,
    kind: kindLabelOf(input),
    sub_kind: input.sub_kind,
    elevation_m: input.ele ?? null,
    description: input.description,
    wikipedia_extract: input.extract,
    opening_hours: input.opening_hours,
    has_phone: Boolean(input.phone),
    has_website: Boolean(input.website),
  };

  const sport = input.sport?.trim() || null;
  const system = `Scrivi per un'app outdoor italiana mini-riassunti di luoghi (vette, paesi, rifugi, laghi, punti di interesse): 2-4 frasi brevi, in italiano, testo semplice senza titoli né elenchi.
Parti dai dati nel JSON; per luoghi noti puoi aggiungere conoscenze generali consolidate (quota, massiccio, cosa li rende celebri). Non inventare orari, prezzi, servizi o condizioni attuali, e se un dato non lo sai con certezza omettilo.
Quando è indicato uno sport, dedica almeno una frase a cosa offre il luogo per quello sport (itinerari tipici, difficoltà indicativa, stagione); se il luogo c'entra poco con quello sport, dillo in breve. Niente consigli medici.`;

  const user = `${sport ? `Sport: ${sport}

` : ""}Luogo:
\`\`\`json
${JSON.stringify(payload, null, 0)}
\`\`\``;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    // SDK 0.39: i campi più recenti (effort, fallback) non sono tipizzati, ma passano nel body.
    const params = {
      model: getModel(),
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: user }],
    };
    const msg = await client.beta.messages.create(
      params as unknown as Parameters<typeof client.beta.messages.create>[0],
    );
    if ("stop_reason" in msg && (msg.stop_reason as string) === "refusal") return null;
    const content = "content" in msg ? msg.content : [];
    const text = content
      .filter((b): b is Extract<(typeof content)[number], { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (text) return text;
  } catch (e) {
    console.warn("poi-summary Anthropic", e);
  }
  return null;
}

const summaryCache = new Map<string, { text: string; at: number }>();
const SUMMARY_TTL_MS = 10 * 60 * 1000;

export function poiSummaryCacheKey(poiId: string, sport?: string | null): string {
  return `poi_sum:${poiId}:${sport ?? ""}`;
}

function getCached(key: string): string | null {
  const row = summaryCache.get(key);
  if (!row) {
    // Cache persistente su SQLite: lo stesso luogo+sport non richiama più il modello.
    const stored = geoCacheGet(key);
    return typeof stored === "string" ? stored : null;
  }
  if (Date.now() - row.at > SUMMARY_TTL_MS) {
    summaryCache.delete(key);
    return null;
  }
  return row.text;
}

function setCached(key: string, text: string): void {
  summaryCache.set(key, { text, at: Date.now() });
  geoCacheSet(key, text);
}

export async function buildPoiSummary(
  poiId: string,
  input: PoiSummaryInput,
  opts: { useLlm?: boolean } = {}
): Promise<PoiSummaryResult> {
  const cacheKey = poiSummaryCacheKey(poiId, input.sport);
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
