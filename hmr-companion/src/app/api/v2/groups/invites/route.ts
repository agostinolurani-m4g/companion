import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  addGroupMember,
  getGroup,
  listPendingInvitesForUser,
  updateGroupInviteStatus,
} from "@/lib/db";
import { serializeGroupSummary } from "@/lib/social-serialize";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const invites = listPendingInvitesForUser(auth.email).map((inv) => {
    const group = getGroup(inv.group_id);
    return {
      group_id: inv.group_id,
      group_name: group?.name ?? inv.group_id,
      invited_by: inv.invited_by,
      created_at: inv.created_at,
    };
  });

  return NextResponse.json({ invites });
}

type PostBody = { group_id?: string; action?: "accept" | "decline" };

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const groupId = (body.group_id ?? "").trim();
  const action = body.action;
  if (!groupId || (action !== "accept" && action !== "decline")) {
    return NextResponse.json({ error: "group_id e action richiesti" }, { status: 400 });
  }

  if (action === "accept") {
    updateGroupInviteStatus(groupId, auth.email, "accepted");
    addGroupMember({ group_id: groupId, username: auth.email, role: "member", joined_at: Date.now() });
    const group = getGroup(groupId);
    return NextResponse.json({ group: group ? serializeGroupSummary(group, auth.email) : null });
  }

  updateGroupInviteStatus(groupId, auth.email, "declined");
  return NextResponse.json({ ok: true });
}
