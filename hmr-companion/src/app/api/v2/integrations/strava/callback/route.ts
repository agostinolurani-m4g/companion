import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { exchangeStravaCode, stravaConfig } from "@/lib/integrations/strava";
import { appBaseUrl, STRAVA_STATE_COOKIE, STRAVA_STATE_COOKIE_PATH } from "@/lib/integrations/http";
import { saveStravaTokens, syncStravaAccount } from "@/lib/integrations/sync";

export const runtime = "nodejs";

function back(req: Request, outcome: string) {
  const res = NextResponse.redirect(`${appBaseUrl(req)}/v2/me?strava=${encodeURIComponent(outcome)}`);
  res.cookies.set(STRAVA_STATE_COOKIE, "", { path: STRAVA_STATE_COOKIE_PATH, maxAge: 0 });
  return res;
}

/** Ritorno da Strava: verifica `state`, salva i token cifrati e avvia il primo import. */
export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.redirect(`${appBaseUrl(req)}/v2`);
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back(req, "denied");

  const store = await cookies();
  const expectedState = store.get(STRAVA_STATE_COOKIE)?.value ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!expectedState || state !== expectedState) return back(req, "invalid_state");

  const code = url.searchParams.get("code");
  if (!code) return back(req, "invalid_state");
  const scopes = (url.searchParams.get("scope") ?? "").split(",");
  if (!scopes.includes("activity:read_all") && !scopes.includes("activity:read")) {
    return back(req, "missing_scope");
  }
  const cfg = stravaConfig();
  if (!cfg) return back(req, "not_configured");

  try {
    const tok = await exchangeStravaCode(cfg, code);
    const db = getDb();
    const owner = auth.email;
    saveStravaTokens(db, owner, tok, scopes.join(","), Date.now());
    after(async () => {
      const r = await syncStravaAccount(db, owner);
      console.info(`[strava] primo import per ${owner}: +${r.imported}${r.error ? ` (errore: ${r.error})` : ""}`);
    });
    return back(req, "connected");
  } catch (e) {
    console.warn("[strava] scambio codice fallito", e);
    return back(req, "error");
  }
}
