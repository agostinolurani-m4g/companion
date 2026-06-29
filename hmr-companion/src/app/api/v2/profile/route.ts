import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { upsertUserProfile, type ProfileLevel } from "@/lib/db";
import { profileForUsername } from "@/lib/social-serialize";

export const runtime = "nodejs";

const VALID_LEVELS = new Set<ProfileLevel>(["beginner", "intermediate", "advanced", "expert"]);

export async function GET() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  return NextResponse.json({ profile: profileForUsername(auth.email) });
}

type PatchBody = {
  display_name?: string;
  bio?: string;
  home_area?: string;
  level?: ProfileLevel;
};

export async function PATCH(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  if (body.level && !VALID_LEVELS.has(body.level)) {
    return NextResponse.json({ error: "Livello non valido" }, { status: 400 });
  }

  const row = upsertUserProfile({
    username: auth.email,
    display_name: body.display_name?.trim(),
    bio: body.bio?.trim(),
    home_area: body.home_area?.trim(),
    level: body.level,
  });

  return NextResponse.json({ profile: profileForUsername(row.username) });
}
