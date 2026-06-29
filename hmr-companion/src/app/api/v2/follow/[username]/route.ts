import { NextResponse } from "next/server";
import { isKnownHmrUser, requireV2Beta } from "@/lib/auth";
import {
  countFollowers,
  countFollowing,
  followUser,
  isFollowing,
  unfollowUser,
} from "@/lib/db";

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

  return NextResponse.json({
    username: u,
    is_following: auth.email === u ? false : isFollowing(auth.email, u),
    followers: countFollowers(u),
    following: countFollowing(u),
  });
}

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { username } = await ctx.params;
  const u = username.trim().toLowerCase();
  if (!isKnownHmrUser(u)) {
    return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
  }
  if (auth.email === u) {
    return NextResponse.json({ error: "Non puoi seguire te stesso" }, { status: 400 });
  }

  followUser(auth.email, u);
  return NextResponse.json({
    ok: true,
    is_following: true,
    followers: countFollowers(u),
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { username } = await ctx.params;
  const u = username.trim().toLowerCase();
  unfollowUser(auth.email, u);
  return NextResponse.json({
    ok: true,
    is_following: false,
    followers: countFollowers(u),
  });
}
