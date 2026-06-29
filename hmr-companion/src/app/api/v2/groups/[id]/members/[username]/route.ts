import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  getGroup,
  getGroupMember,
  isGroupAdmin,
  isGroupOwner,
  removeGroupMember,
} from "@/lib/db";
import { serializeGroupSummary } from "@/lib/social-serialize";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; username: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id, username } = await ctx.params;
  const group = getGroup(id);
  if (!group) return NextResponse.json({ error: "Gruppo non trovato" }, { status: 404 });

  const target = username.trim().toLowerCase();
  const targetMember = getGroupMember(id, target);
  if (!targetMember) {
    return NextResponse.json({ error: "Membro non trovato" }, { status: 404 });
  }

  const self = auth.email;
  const canRemove =
    self === target ||
    isGroupOwner(id, self) ||
    (isGroupAdmin(id, self) && targetMember.role === "member");

  if (!canRemove) {
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  }
  if (targetMember.role === "owner") {
    return NextResponse.json({ error: "Non puoi rimuovere il proprietario" }, { status: 400 });
  }

  removeGroupMember(id, target);
  return NextResponse.json({ group: serializeGroupSummary(getGroup(id)!, auth.email) });
}
