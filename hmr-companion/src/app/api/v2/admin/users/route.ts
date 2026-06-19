import { NextResponse } from "next/server";
import { hashPassword, normalizeUsername, requireAdmin } from "@/lib/auth";
import {
  countAppUsersByRole,
  getAppUser,
  listAppUsers,
  upsertAppUser,
  type AppUserRole,
} from "@/lib/db";

export const runtime = "nodejs";

function serializeUser(row: ReturnType<typeof listAppUsers>[number]) {
  return {
    username: row.username,
    role: row.role,
    active: row.active === 1,
    created_at: row.created_at,
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  return NextResponse.json({ users: listAppUsers().map(serializeUser) });
}

type PostBody = {
  username?: string;
  password?: string;
  role?: AppUserRole;
  active?: boolean;
};

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";
  const role = body.role ?? "user";
  const active = body.active !== false;

  if (!username || username.length < 2) {
    return NextResponse.json({ error: "Username non valido" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Password minimo 6 caratteri" }, { status: 400 });
  }
  if (role !== "user" && role !== "admin") {
    return NextResponse.json({ error: "role non valido" }, { status: 400 });
  }

  const existing = getAppUser(username);
  if (existing) {
    return NextResponse.json({ error: "Utente già esistente" }, { status: 409 });
  }

  upsertAppUser({
    username,
    password_hash: hashPassword(password),
    role,
    active: active ? 1 : 0,
  });

  const row = getAppUser(username);
  return NextResponse.json({ ok: true, user: row ? serializeUser(row) : null }, { status: 201 });
}
