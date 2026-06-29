import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { upsertUserProfile } from "@/lib/db";
import { profileForUsername } from "@/lib/social-serialize";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file richiesto" }, { status: 400 });
  }

  const relDir = path.join("data", "uploads", "avatars");
  const absDir = path.join(process.cwd(), relDir);
  fs.mkdirSync(absDir, { recursive: true });

  const photoId = crypto.randomUUID();
  const ext = path.extname(file.name) || ".jpg";
  const filename = `${auth.email}-${photoId}${ext}`;
  const relPath = path.join(relDir, filename).replace(/\\/g, "/");
  const absPath = path.join(process.cwd(), relPath);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absPath, buf);

  upsertUserProfile({ username: auth.email, avatar_path: relPath });

  return NextResponse.json({ profile: profileForUsername(auth.email) }, { status: 201 });
}
