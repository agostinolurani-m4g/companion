import { decodePolyline } from "@/lib/polyline";
import { compactLine } from "@/lib/activities/geo";
import { mapStravaSport } from "@/lib/activities/sport-map";
import type { UserRouteActivity } from "@/lib/sports";

/**
 * Client minimale dell'API Strava v3 (OAuth2).
 * Docs: https://developers.strava.com/docs/reference/
 *
 * Vincoli dell'accordo API (rispettati a valle):
 * - i dati di un atleta sono mostrati SOLO all'atleta stesso (heatmap personale);
 * - alla revoca/disconnessione i dati importati vanno cancellati.
 */

const AUTH_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const DEAUTH_URL = "https://www.strava.com/oauth/deauthorize";
const API = "https://www.strava.com/api/v3";

export const STRAVA_SCOPES = "read,activity:read_all";

export type StravaConfig = { clientId: string; clientSecret: string };

export function stravaConfig(): StravaConfig | null {
  const clientId = process.env.STRAVA_CLIENT_ID?.trim();
  const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export class StravaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
  get isRateLimit(): boolean {
    return this.status === 429;
  }
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export function buildStravaAuthorizeUrl(cfg: StravaConfig, redirectUri: string, state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("approval_prompt", "auto");
  u.searchParams.set("scope", STRAVA_SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

export type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string; username?: string };
};

async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new StravaError(`Strava ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as T;
}

export function exchangeStravaCode(cfg: StravaConfig, code: string): Promise<StravaTokenResponse> {
  return postForm(TOKEN_URL, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
  });
}

export function refreshStravaToken(cfg: StravaConfig, refreshToken: string): Promise<StravaTokenResponse> {
  return postForm(TOKEN_URL, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

export async function deauthorizeStrava(accessToken: string): Promise<void> {
  await postForm(DEAUTH_URL, { access_token: accessToken }).catch(() => undefined);
}

async function apiGet<T>(accessToken: string, path: string, params?: Record<string, string | number>): Promise<T> {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
  const res = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new StravaError(`Strava ${res.status} ${path}: ${text.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as T;
}

export type StravaActivity = {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string;
  distance?: number;
  total_elevation_gain?: number;
  moving_time?: number;
  trainer?: boolean;
  manual?: boolean;
  private?: boolean;
  map?: { summary_polyline?: string | null; polyline?: string | null };
};

export function listStravaActivities(
  accessToken: string,
  opts: { after: number; page: number; perPage?: number },
): Promise<StravaActivity[]> {
  return apiGet(accessToken, "/athlete/activities", {
    after: opts.after,
    page: opts.page,
    per_page: opts.perPage ?? 100,
  });
}

export function getStravaActivity(accessToken: string, id: string | number): Promise<StravaActivity> {
  return apiGet(accessToken, `/activities/${id}`, { include_all_efforts: "false" });
}

export type MappedStravaActivity = {
  external_id: string;
  sport: UserRouteActivity;
  name: string;
  start_time: number;
  distance_m: number;
  elev_gain_m: number;
  moving_time_s: number | null;
  line: GeoJSON.LineString;
};

/** Converte un'attività Strava; `null` se indoor/manuale/senza traccia o sport non supportato. */
export function mapStravaActivity(a: StravaActivity): MappedStravaActivity | null {
  if (a.trainer || a.manual) return null;
  const sport = mapStravaSport(a.sport_type, a.type);
  if (!sport) return null;
  const encoded = a.map?.polyline || a.map?.summary_polyline;
  if (!encoded) return null;
  const coords = decodePolyline(encoded);
  if (coords.length < 2) return null;
  const start = Date.parse(a.start_date);
  return {
    external_id: String(a.id),
    sport,
    name: (a.name || "Attività Strava").slice(0, 200),
    start_time: Number.isFinite(start) ? start : Date.now(),
    distance_m: Math.round(a.distance ?? 0),
    elev_gain_m: Math.round(a.total_elevation_gain ?? 0),
    moving_time_s: a.moving_time ?? null,
    line: compactLine(coords.map(([lng, lat]) => ({ lng, lat }))),
  };
}
