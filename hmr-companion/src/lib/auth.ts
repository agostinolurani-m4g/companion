import crypto from "node:crypto";
import { cookies } from "next/headers";
import {
  deleteAuthSessionById,
  getAuthMagicLinkByTokenHash,
  getAuthSessionByTokenHash,
  insertAuthSession,
  markAuthMagicLinkUsed,
  pruneAuthMagicLinks,
  pruneAuthSessions,
} from "@/lib/db";

export const AUTH_COOKIE_NAME = "hmr_auth_session";
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const ALLOWED_EMAILS = new Set(
  (process.env.HMR_ALLOWED_EMAILS ?? "agostino.lurani@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
  return ALLOWED_EMAILS.has(normalizeEmail(email));
}

export function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createMagicLinkExpiry(now: number): number {
  return now + MAGIC_LINK_TTL_MS;
}

export function createSessionExpiry(now: number): number {
  return now + SESSION_TTL_MS;
}

export function getAuthBaseUrl(): string {
  const envUrl = process.env.HMR_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return "http://localhost:3002";
}

export function consumeMagicLink(token: string, now: number): { email: string } | null {
  pruneAuthMagicLinks(now);
  const row = getAuthMagicLinkByTokenHash(hashToken(token));
  if (!row || row.used_at != null || row.expires_at <= now) return null;
  markAuthMagicLinkUsed(row.id, now);
  return { email: row.email };
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
  return session.email;
}

export async function requireAuthenticated(): Promise<{ email: string } | null> {
  const email = await getCurrentSessionEmail();
  if (!email) return null;
  return { email };
}
