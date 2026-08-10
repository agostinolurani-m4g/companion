import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getGroup, isGroupOwner, updateGroup } from "@/lib/db";
import { serializeGroupSummary } from "@/lib/social-serialize";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const group = getGroup(id);
  if (!group) return NextResponse.json({ error: "Gruppo non trovato" }, { status: 404 });
  if (!isGroupOwner(id, auth.email)) {
    return NextResponse.json({ error: "Solo il proprietario può cambiare l'avatar" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file richiesto" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File troppo grande" }, { status: 400 });
  }

  const relDir = path.join("data", "uploads", "v2", "groups", id);
  fs.mkdirSync(path.join(process.cwd(), relDir), { recursive: true });
  const ext = path.extname(file.name) || ".jpg";
  const relPath = path.join(relDir, `${crypto.randomUUID()}${ext}`).replace(/\\/g, "/");
  fs.writeFileSync(path.join(process.cwd(), relPath), Buffer.from(await file.arrayBuffer()));

  updateGroup(id, { avatar_path: relPath, updated_at: Date.now() });
  return NextResponse.json({ group: serializeGroupSummary(getGroup(id)!, auth.email) });
}
