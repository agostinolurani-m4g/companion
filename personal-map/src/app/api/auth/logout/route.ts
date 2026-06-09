import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, hashToken } from "@/lib/auth";
import { deleteAuthSessionById, getAuthSessionByTokenHash } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (token) {
    const session = getAuthSessionByTokenHash(hashToken(token));
    if (session) deleteAuthSessionById(session.id);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
