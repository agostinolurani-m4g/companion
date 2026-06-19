import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { CATEGORY_ORDER } from "@/lib/categories";
import type { PoiCategory } from "@/lib/db";
import { buildPoiSummary, type PoiSummaryInput } from "@/lib/poi-summary";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const VALID_CATEGORY = new Set<string>(CATEGORY_ORDER);

type Body = Partial<PoiSummaryInput> & {
  useLlm?: boolean;
};

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  if (!id?.trim()) return NextResponse.json({ error: "ID POI mancante" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const category = body.category;
  if (typeof category !== "string" || !VALID_CATEGORY.has(category)) {
    return NextResponse.json({ error: "Categoria POI non valida" }, { status: 400 });
  }
  if (typeof body.sub_kind !== "string" || !body.sub_kind.trim()) {
    return NextResponse.json({ error: "sub_kind mancante" }, { status: 400 });
  }

  const input: PoiSummaryInput = {
    name: typeof body.name === "string" ? body.name : null,
    category: category as PoiCategory,
    sub_kind: body.sub_kind,
    description: body.description ?? null,
    extract: body.extract ?? null,
    opening_hours: body.opening_hours ?? null,
    phone: body.phone ?? null,
    website: body.website ?? null,
  };

  const result = await buildPoiSummary(id, input, { useLlm: body.useLlm !== false });
  return NextResponse.json({ ok: true, id, ...result });
}
