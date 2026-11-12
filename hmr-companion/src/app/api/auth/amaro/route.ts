import { after, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, createSessionForEmail } from "@/lib/auth";
import { exchangeAmaroCode, resolveLocalUserForAmaroMember } from "@/lib/amaro-sso";
import { getDb } from "@/lib/db";
import { appBaseUrl, isSecureRequest } from "@/lib/integrations/http";
import { maybeSyncOnLogin } from "@/lib/integrations/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dove atterra il tesserato dopo l'accesso da Amaro. */
const LANDING_PATH = "/v2/esplora";

function back(req: Request, error: string): NextResponse {
  const res = NextResponse.redirect(`${appBaseUrl(req)}/?amaro=${error}`, 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Arrivo dall'area tesserati di Amaro: `?code=` firmato da Amaro, a vita breve.
 * Lo scambiamo server-to-server, poi apriamo la sessione locale.
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.trim() ?? "";
  if (!code || code.length > 2048) return back(req, "invalid");

  const result = await exchangeAmaroCode(code);
  if (!result.ok) return back(req, result.reason);

  const now = Date.now();
  const username = resolveLocalUserForAmaroMember(result.member, now);
  if (!username) return back(req, "disabled");

  const session = createSessionForEmail(username, now);
  const res = NextResponse.redirect(`${appBaseUrl(req)}${LANDING_PATH}`, 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.cookies.set(AUTH_COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    expires: new Date(session.expiresAt),
  });
  after(() => maybeSyncOnLogin(getDb(), username));
  return res;
}
