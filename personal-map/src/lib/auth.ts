import crypto from "node:crypto";
import { cookies } from "next/headers";
import {
  deleteAuthSessionById,
  getAuthSessionByTokenHash,
  insertAuthSession,
  pruneAuthSessions,
} from "@/lib/db";

export const AUTH_COOKIE_NAME = "personal_map_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const FIXED_LOGIN: Readonly<Record<string, string>> = {
  ago: "hellenicago26",
  ale: "hellenicale26",
  gala: "hellenicgala26",
  babbo: "hellenicbabbo26",
  marti: "helenicmarti2026",
};

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isKnownUser(identity: string): boolean {
  const u = normalizeUsername(identity);
  return u !== "" && u in FIXED_LOGIN;
}

function timingSafeEqualUtf8Strings(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function verifyPasswordLogin(username: string, password: string): boolean {
  const u = normalizeUsername(username);
  const expected = FIXED_LOGIN[u];
  if (!expected) return false;
  return timingSafeEqualUtf8Strings(password, expected);
}

export function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSessionExpiry(now: number): number {
  return now + SESSION_TTL_MS;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createSessionForEmail(email: string, now: number): { token: string; expiresAt: number } {
  const token = createOpaqueToken();
  const expiresAt = createSessionExpiry(now);
  insertAuthSession({
    id: crypto.randomUUID(),
    email: normalizeEmail(email),
    token_hash: hashToken(token),
    created_at: now,
    expires_at: expiresAt,
  });
  return { token, expiresAt };
}

export async function getCurrentSessionEmail(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  const now = Date.now();
  pruneAuthSessions(now);
  const session = getAuthSessionByTokenHash(hashToken(token));
  if (!session || session.expires_at <= now) {
    if (session) deleteAuthSessionById(session.id);
    return null;
  }
  if (!isKnownUser(session.email)) {
    deleteAuthSessionById(session.id);
    return null;
  }
  return session.email;
}

export async function requireAuthenticated(): Promise<{ email: string } | null> {
  const email = await getCurrentSessionEmail();
  if (!email) return null;
  return { email };
}

export const ADMIN_USERS = new Set(["ago"]);

export function isAdminUser(username: string): boolean {
  return ADMIN_USERS.has(normalizeUsername(username));
}
