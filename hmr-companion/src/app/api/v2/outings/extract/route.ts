import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { emptyOutingExtractMeta, type OutingExtractMeta } from "@/lib/outing-extract";
import { isUserRouteActivity, isWinterSport, SPORTS, type UserRouteActivity } from "@/lib/sports";

export const runtime = "nodejs";

const DEFAULT_MODEL = "claude-3-5-haiku-20241022";

function systemPrompt(activity: UserRouteActivity): string {
  const sport = SPORTS[activity];
  const scale = sport.difficultyScale !== "—" ? ` Scala di difficoltà attesa: ${sport.difficultyScale}.` : "";
  const notes = isWinterSport(activity)
    ? "condizioni, neve, pericoli"
    : "condizioni del fondo, acqua, tratti esposti, pericoli";
  return `Sei un assistente per uscite outdoor (${sport.label}) sulle Alpi e in montagna.${scale}
Estrai metadati da una descrizione vocale/testuale di una gita.
Rispondi SOLO con JSON valido (nessun markdown), schema:
{
  "name": "string",
  "zone": "string (valle/massiccio/zona)",
  "elev_gain_m": number|null,
  "elev_loss_m": number|null,
  "difficulty": "string|null (grado nella scala dello sport)",
  "exposition": "string|null (N, NE, E, ...)",
  "elevation_max_m": number|null,
  "notes": "string|null (${notes})"
}
Non inventare dati non presenti: usa null se mancanti.`;
}

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY non configurata" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { transcript?: string; activity?: string };
  const transcript = (body.transcript ?? "").trim();
  if (transcript.length < 10) {
    return NextResponse.json({ error: "Testo troppo corto" }, { status: 400 });
  }
  const activity: UserRouteActivity = body.activity && isUserRouteActivity(body.activity) ? body.activity : "ski";

  const model =
    process.env.HMR_OUTING_EXTRACT_MODEL?.trim() ||
    process.env.HMR_SKI_EXTRACT_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    DEFAULT_MODEL;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model,
      max_tokens: 500,
      temperature: 0.1,
      system: systemPrompt(activity),
      messages: [{ role: "user", content: transcript }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json({ error: "Risposta LLM vuota" }, { status: 502 });
    }
    const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const meta = { ...emptyOutingExtractMeta(), ...(JSON.parse(raw) as Partial<OutingExtractMeta>) };
    return NextResponse.json({ meta });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Estrazione fallita" },
      { status: 500 },
    );
  }
}
