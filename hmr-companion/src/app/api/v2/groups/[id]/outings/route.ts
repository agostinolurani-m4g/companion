import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getGroupMember, listOutingsForGroup } from "@/lib/db";
import { serializeOutings } from "@/lib/outings";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  if (!getGroupMember(id, auth.email)) {
    return NextResponse.json({ error: "Non sei membro" }, { status: 403 });
  }

  const outings = serializeOutings(listOutingsForGroup(id));
  return NextResponse.json({ outings });
}
