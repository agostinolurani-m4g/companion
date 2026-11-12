/** Origine pubblica dell'app (per redirect OAuth e webhook). */
export function appBaseUrl(req: Request): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || u.host;
  return `${proto}://${host}`;
}

export function stravaRedirectUri(req: Request): string {
  return `${appBaseUrl(req)}/api/v2/integrations/strava/callback`;
}

export function isSecureRequest(req: Request): boolean {
  return appBaseUrl(req).startsWith("https://");
}

export const STRAVA_STATE_COOKIE = "hmr_strava_oauth_state";
export const STRAVA_STATE_COOKIE_PATH = "/api/v2/integrations/strava";
