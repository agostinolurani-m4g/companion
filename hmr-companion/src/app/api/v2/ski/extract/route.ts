import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";

export const runtime = "nodejs";

const DEFAULT_MODEL = "claude-3-5-haiku-20241022";

export type SkiExtractMeta = {
  name: string;
  zone: string;
  elev_gain_m: number | null;
  elev_loss_m: number | null;
  difficulty: string | null;
  exposition: string | null;
  elevation_max_m: number | null;
  notes: string | null;
};

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY non configurata" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { transcript?: string };
  const transcript = (body.transcript ?? "").trim();
  if (transcript.length < 10) {
    return NextResponse.json({ error: "Testo troppo corto" }, { status: 400 });
  }

  const model =
    process.env.HMR_SKI_EXTRACT_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    DEFAULT_MODEL;

  const system = `Sei un assistente per scialpinismo in Alpi italiane.
Estrai metadati da una descrizione vocale/testuale di una gita.
Rispondi SOLO con JSON valido (nessun markdown), schema:
{
  "name": "string",
  "zone": "string (valle/massiccio)",
  "elev_gain_m": number|null,
  "elev_loss_m": number|null,
  "difficulty": "string|null (es. PD, PD+, AD, S2-S4)",
  "exposition": "string|null (N, NE, E, ...)",
  "elevation_max_m": number|null,
  "notes": "string|null (condizioni, neve, pericoli)"
}
Non inventare dati non presenti: usa null se mancanti.`;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model,
      max_tokens: 500,
      temperature: 0.1,
      system,
      messages: [{ role: "user", content: transcript }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json({ error: "Risposta LLM vuota" }, { status: 502 });
    }
    const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const meta = JSON.parse(raw) as SkiExtractMeta;
    return NextResponse.json({ meta });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Estrazione fallita" },
      { status: 500 },
    );
  }
}
