import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb, upsertUserProfile, type ProfileLevel } from "@/lib/db";
import { getAthleteGender, isGender, setAthleteGender } from "@/lib/segments/store";
import { profileForUsername } from "@/lib/social-serialize";

export const runtime = "nodejs";

const VALID_LEVELS = new Set<ProfileLevel>(["beginner", "intermediate", "advanced", "expert"]);

export async function GET() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  return NextResponse.json({ profile: { ...profileForUsername(auth.email, true), gender: getAthleteGender(getDb(), auth.email) } });
}

type PatchBody = {
  display_name?: string;
  bio?: string;
  home_area?: string;
  level?: ProfileLevel;
  /** Facoltativo, solo per le classifiche dei segmenti: "" | "f" | "m" | "x". */
  gender?: string;
};

export async function PATCH(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  if (body.level && !VALID_LEVELS.has(body.level)) {
    return NextResponse.json({ error: "Livello non valido" }, { status: 400 });
  }
  if (body.gender !== undefined) {
    if (!isGender(body.gender)) return NextResponse.json({ error: "Valore non valido" }, { status: 400 });
    setAthleteGender(getDb(), auth.email, body.gender, Date.now());
  }

  const row = upsertUserProfile({
    username: auth.email,
    display_name: body.display_name?.trim(),
    bio: body.bio?.trim(),
    home_area: body.home_area?.trim(),
    level: body.level,
  });

  return NextResponse.json({ profile: { ...profileForUsername(row.username), gender: getAthleteGender(getDb(), row.username) } });
}
