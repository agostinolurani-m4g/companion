import { NextResponse } from "next/server";
import { isKnownHmrUser, requireV2Beta } from "@/lib/auth";
import { addGroupMember, getGroup, getGroupMember, isGroupAdmin } from "@/lib/db";
import { serializeGroupSummary } from "@/lib/social-serialize";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const group = getGroup(id);
  if (!group) return NextResponse.json({ error: "Gruppo non trovato" }, { status: 404 });
  if (!isGroupAdmin(id, auth.email)) {
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { username?: string };
  const u = (body.username ?? "").trim().toLowerCase();
  if (!u) return NextResponse.json({ error: "username richiesto" }, { status: 400 });
  if (!isKnownHmrUser(u)) {
    return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
  }
  if (getGroupMember(id, u)) {
    return NextResponse.json({ error: "Già membro" }, { status: 409 });
  }

  addGroupMember({ group_id: id, username: u, role: "member", joined_at: Date.now() });
  return NextResponse.json({ group: serializeGroupSummary(getGroup(id)!, auth.email) });
}
