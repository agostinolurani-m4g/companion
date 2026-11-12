/**
 * Accesso dei tesserati Amaro (SSO dall'area tesserati di amarobici.it).
 *
 * Amaro reindirizza qui con un codice firmato a vita breve; noi lo scambiamo
 * server-to-server con i dati minimi del tesserato. Nessun segreto condiviso:
 * il codice lo firma e lo verifica solo Amaro.
 */
import crypto from "node:crypto";
import { hashPassword, isKnownHmrUser } from "@/lib/auth";
import {
  getAmaroMemberById,
  getAppUser,
  getUserProfile,
  insertAmaroMember,
  touchAmaroMember,
  upsertAppUser,
  upsertUserProfile,
} from "@/lib/db";

export type AmaroMember = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  membershipStatus: string;
};

export type AmaroExchangeResult =
  | { ok: true; member: AmaroMember }
  | { ok: false; reason: "invalid" | "inactive" | "unreachable" };

const DEFAULT_AMARO_BASE_URL = "https://www.amarobici.it";

export function amaroBaseUrl(): string {
  const configured = process.env.AMARO_BASE_URL?.trim();
  return (configured || DEFAULT_AMARO_BASE_URL).replace(/\/+$/, "");
}

/** Pagina Amaro che genera il codice (richiede il login nell'area tesserati). */
export function amaroStartUrl(): string {
  return `${amaroBaseUrl()}/area-tesserati/companion`;
}

function parseMember(raw: unknown): AmaroMember | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "number" || !Number.isInteger(m.id) || m.id <= 0) return null;
  return {
    id: m.id,
    email: typeof m.email === "string" ? m.email.trim().toLowerCase() : "",
    firstName: typeof m.firstName === "string" ? m.firstName.trim() : "",
    lastName: typeof m.lastName === "string" ? m.lastName.trim() : "",
    membershipStatus: typeof m.membershipStatus === "string" ? m.membershipStatus : "",
  };
}

export async function exchangeAmaroCode(
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<AmaroExchangeResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${amaroBaseUrl()}/api/wattlab/companion/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (res.status === 403) return { ok: false, reason: "inactive" };
  if (res.status === 401 || res.status === 400 || res.status === 422) {
    return { ok: false, reason: "invalid" };
  }
  if (!res.ok) return { ok: false, reason: "unreachable" };
  const data = (await res.json().catch(() => null)) as { member?: unknown } | null;
  const member = parseMember(data?.member);
  if (!member) return { ok: false, reason: "invalid" };
  if (member.membershipStatus !== "active") return { ok: false, reason: "inactive" };
  return { ok: true, member };
}

function slug(part: string): string {
  return part
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Username locale per un tesserato: `nome.cognome`, con l'id Amaro se già preso. */
export function usernameForAmaroMember(
  member: Pick<AmaroMember, "id" | "firstName" | "lastName">,
  isTaken: (username: string) => boolean
): string {
  const first = slug(member.firstName);
  const last = slug(member.lastName);
  const base = [first, last].filter(Boolean).join(".") || `tesserato${member.id}`;
  if (!isTaken(base)) return base;
  return `${base}.${member.id}`;
}

export function displayNameForAmaroMember(member: Pick<AmaroMember, "firstName" | "lastName">): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ");
}

/**
 * Trova o crea l'utente locale collegato al tesserato e restituisce lo username
 * da usare per la sessione. `null` se l'utente locale è stato disattivato.
 */
export function resolveLocalUserForAmaroMember(member: AmaroMember, now: number): string | null {
  const linked = getAmaroMemberById(member.id);
  if (linked) {
    const user = getAppUser(linked.username);
    if (user && user.active !== 1) return null;
    if (!user) {
      // Riga utente rimossa a mano: la ricreo, il collegamento resta lo stesso.
      createPasswordlessUser(linked.username, now);
    }
    touchAmaroMember(member.id, member.email, now);
    return linked.username;
  }

  const username = usernameForAmaroMember(
    member,
    (u) => getAppUser(u) !== undefined || isKnownHmrUser(u)
  );
  createPasswordlessUser(username, now);
  insertAmaroMember({ member_id: member.id, username, email: member.email, now });
  const displayName = displayNameForAmaroMember(member);
  if (displayName && !getUserProfile(username)?.display_name) {
    upsertUserProfile({ username, display_name: displayName });
  }
  return username;
}

/** Utente senza password utilizzabile: entra solo passando da Amaro. */
function createPasswordlessUser(username: string, now: number): void {
  upsertAppUser({
    username,
    password_hash: hashPassword(crypto.randomBytes(32).toString("hex")),
    role: "user",
    active: 1,
    created_at: now,
  });
}
