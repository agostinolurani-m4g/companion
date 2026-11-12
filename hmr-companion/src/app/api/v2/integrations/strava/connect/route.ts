import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { buildStravaAuthorizeUrl, stravaConfig } from "@/lib/integrations/strava";
import {
  appBaseUrl,
  isSecureRequest,
  STRAVA_STATE_COOKIE,
  STRAVA_STATE_COOKIE_PATH,
  stravaRedirectUri,
} from "@/lib/integrations/http";

export const runtime = "nodejs";

/** Avvia il flusso OAuth Strava. */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.redirect(`${appBaseUrl(req)}/v2`);
  const cfg = stravaConfig();
  if (!cfg) return NextResponse.redirect(`${appBaseUrl(req)}/v2/me?strava=not_configured`);
  const state = crypto.randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(buildStravaAuthorizeUrl(cfg, stravaRedirectUri(req), state));
  res.cookies.set(STRAVA_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: STRAVA_STATE_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
