import { NextResponse } from "next/server";
import { listNotableSections } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const sections = listNotableSections(id);
  return NextResponse.json({ sections });
}
