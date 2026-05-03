import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  consumeMagicLink,
  createSessionForEmail,
  getAuthBaseUrl,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return NextResponse.redirect(`${getAuthBaseUrl()}/?auth=missing`);
  }
  const now = Date.now();
  const consumed = consumeMagicLink(token, now);
  if (!consumed) {
    return NextResponse.redirect(`${getAuthBaseUrl()}/?auth=invalid`);
  }

  const session = createSessionForEmail(consumed.email, now);
  const res = NextResponse.redirect(`${getAuthBaseUrl()}/`);
  res.cookies.set(AUTH_COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getAuthBaseUrl().startsWith("https://"),
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return res;
}
