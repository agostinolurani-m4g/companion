import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  deleteGroup,
  getGroup,
  getGroupMember,
  getUserRoute,
  isGroupOwner,
  listGroupMembers,
  updateGroup,
  type GroupType,
} from "@/lib/db";
import { serializeGroupSummary } from "@/lib/social-serialize";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const VALID_TYPES = new Set<GroupType>(["friends", "club", "trip", "custom"]);

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const group = getGroup(id);
  if (!group) return NextResponse.json({ error: "Gruppo non trovato" }, { status: 404 });

  const member = getGroupMember(id, auth.email);
  if (!member) return NextResponse.json({ error: "Non sei membro di questo gruppo" }, { status: 403 });

  return NextResponse.json({
    group: serializeGroupSummary(group, auth.email),
    my_role: member.role,
  });
}

type PatchBody = {
  name?: string;
  type?: GroupType;
  description?: string;
  route_id?: string | null;
};

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const group = getGroup(id);
  if (!group) return NextResponse.json({ error: "Gruppo non trovato" }, { status: 404 });
  if (!isGroupOwner(id, auth.email)) {
    return NextResponse.json({ error: "Solo il proprietario può modificare il gruppo" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  if (body.type && !VALID_TYPES.has(body.type)) {
    return NextResponse.json({ error: "Tipo non valido" }, { status: 400 });
  }
  if (body.route_id) {
    const route = getUserRoute(body.route_id);
    if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  }

  updateGroup(id, {
    name: body.name?.trim(),
    type: body.type,
    description: body.description?.trim(),
    route_id: body.route_id,
    updated_at: Date.now(),
  });

  const updated = getGroup(id)!;
  return NextResponse.json({ group: serializeGroupSummary(updated, auth.email) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  if (!isGroupOwner(id, auth.email)) {
    return NextResponse.json({ error: "Solo il proprietario può eliminare il gruppo" }, { status: 403 });
  }

  deleteGroup(id);
  return NextResponse.json({ ok: true });
}
