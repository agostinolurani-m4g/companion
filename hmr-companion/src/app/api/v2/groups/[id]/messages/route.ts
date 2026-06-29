import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getGroup, getGroupMember, insertGroupMessage, listGroupMessages } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const group = getGroup(id);
  if (!group) return NextResponse.json({ error: "Gruppo non trovato" }, { status: 404 });
  if (!getGroupMember(id, auth.email)) {
    return NextResponse.json({ error: "Non sei membro di questo gruppo" }, { status: 403 });
  }

  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? "0");

  const messages = listGroupMessages(id, since > 0 ? { since } : { limit: 200 });
  return NextResponse.json({ messages });
}

type PostBody = { body?: string };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const group = getGroup(id);
  if (!group) return NextResponse.json({ error: "Gruppo non trovato" }, { status: 404 });
  if (!getGroupMember(id, auth.email)) {
    return NextResponse.json({ error: "Non sei membro di questo gruppo" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const text = (body.body ?? "").trim();
  if (!text) return NextResponse.json({ error: "Messaggio vuoto" }, { status: 400 });
  if (text.length > 4000) {
    return NextResponse.json({ error: "Messaggio troppo lungo" }, { status: 400 });
  }

  const now = Date.now();
  const msg = insertGroupMessage({
    id: crypto.randomUUID(),
    group_id: id,
    from_user: auth.email,
    body: text,
    created_at: now,
  });

  return NextResponse.json({ message: msg }, { status: 201 });
}
