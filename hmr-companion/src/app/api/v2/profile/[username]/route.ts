import { NextResponse } from "next/server";
import { isKnownHmrUser, requireV2Beta } from "@/lib/auth";
import {
  countFollowers,
  countFollowing,
  countPublicRoutesForOwner,
  ensureUserProfile,
  getUserStats,
  isFollowing,
  listPublicRoutes,
  listUserPhotos,
} from "@/lib/db";
import { serializeProfile, serializeUserStats } from "@/lib/social-serialize";

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
  const stats = getUserStats(u);
  const profile = serializeProfile(row, {
    followers: countFollowers(u),
    following: countFollowing(u),
    public_routes: countPublicRoutesForOwner(u),
    stats,
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

  const photos = listUserPhotos(u, 12).map((p) => ({
    id: p.id,
    lng: p.lng,
    lat: p.lat,
    caption: p.caption,
    photo_path: p.photo_path,
    url: `/api/field-photo?path=${encodeURIComponent(p.photo_path)}`,
    created_at: p.created_at,
  }));

  return NextResponse.json({
    profile,
    stats: serializeUserStats(stats),
    routes,
    photos,
    is_self: auth.email === u,
    is_following: auth.email === u ? false : isFollowing(auth.email, u),
  });
}
