import { NextResponse } from "next/server";
import { isKnownHmrUser, requireV2Beta } from "@/lib/auth";
import {
  countFollowers,
  countFollowing,
  countPublicRoutesForOwner,
  ensureUserProfile,
  isFollowing,
  listPublicRoutes,
} from "@/lib/db";
import { serializeProfile } from "@/lib/social-serialize";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ username: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { username } = await ctx.params;
  const u = username.trim().toLowerCase();
  if (!isKnownHmrUser(u)) {
    return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
  }

  const row = ensureUserProfile(u);
  const profile = serializeProfile(row, {
    followers: countFollowers(u),
    following: countFollowing(u),
    public_routes: countPublicRoutesForOwner(u),
  });

  const routes = listPublicRoutes()
    .filter((r) => r.owner === u)
    .map((r) => ({
      id: r.id,
      name: r.name,
      activity: r.activity,
      length_km: r.length_km,
      elev_gain_m: r.elev_gain_m,
      updated_at: r.updated_at,
    }));

  return NextResponse.json({
    profile,
    routes,
    is_self: auth.email === u,
    is_following: auth.email === u ? false : isFollowing(auth.email, u),
  });
}
