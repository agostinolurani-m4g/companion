import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isKnownHmrUser, requireV2Beta } from "@/lib/auth";
import {
  addGroupMember,
  getUserRoute,
  insertGroup,
  listGroupsForUser,
  type GroupType,
} from "@/lib/db";
import { serializeGroupSummary } from "@/lib/social-serialize";

export const runtime = "nodejs";

const VALID_TYPES = new Set<GroupType>(["friends", "club", "trip", "custom"]);

export async function GET() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const groups = listGroupsForUser(auth.email).map((g) =>
    serializeGroupSummary(g, auth.email)
  );
  return NextResponse.json({ groups });
}

type PostBody = {
  name?: string;
  type?: GroupType;
  description?: string;
  route_id?: string | null;
  members?: string[];
};

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Nome gruppo richiesto" }, { status: 400 });

  const type = body.type ?? "friends";
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: "Tipo gruppo non valido" }, { status: 400 });
  }

  if (body.route_id) {
    const route = getUserRoute(body.route_id);
    if (!route) return NextResponse.json({ error: "Percorso non trovato" }, { status: 404 });
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  insertGroup({
    id,
    name,
    type,
    description: (body.description ?? "").trim(),
    created_by: auth.email,
    route_id: body.route_id ?? null,
    created_at: now,
    updated_at: now,
  });

  addGroupMember({ group_id: id, username: auth.email, role: "owner", joined_at: now });

  const members = new Set<string>([auth.email]);
  for (const raw of body.members ?? []) {
    const u = raw.trim().toLowerCase();
    if (!u || members.has(u)) continue;
    if (!isKnownHmrUser(u)) continue;
    addGroupMember({ group_id: id, username: u, role: "member", joined_at: now });
    members.add(u);
  }

  const group = listGroupsForUser(auth.email).find((g) => g.id === id)!;
  return NextResponse.json({ group: serializeGroupSummary(group, auth.email) }, { status: 201 });
}
