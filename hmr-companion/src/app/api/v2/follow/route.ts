import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { listFollowing } from "@/lib/db";
import { profileForUsername } from "@/lib/social-serialize";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const usernames = listFollowing(auth.email);
  const following = usernames.map((u) => profileForUsername(u));

  return NextResponse.json({ following });
}
