import { NextResponse } from "next/server";
import { listCheckpoints } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const checkpoints = listCheckpoints(id);
  return NextResponse.json({ checkpoints });
}
