import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  createSessionForEmail,
  verifyPasswordLogin,
} from "@/lib/auth";

export const runtime = "nodejs";

type PostBody = { username?: string; password?: string };

function cookieSecureFromRequest(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded?.split(",")[0]?.trim() === "https") return true;
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PostBody;
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json({ error: "Nome utente e password obbligatori" }, { status: 400 });
  }
  if (!verifyPasswordLogin(username, password)) {
    return NextResponse.json({ error: "Credenziali non valide" }, { status: 401 });
  }

  const now = Date.now();
  const session = createSessionForEmail(username, now);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecureFromRequest(req),
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return res;
}
