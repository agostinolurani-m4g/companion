import { NextResponse } from "next/server";
import { hashPassword, normalizeUsername, requireAdmin } from "@/lib/auth";
import {
  countAppUsersByRole,
  deleteAppUser,
  getAppUser,
  upsertAppUser,
  type AppUserRole,
} from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ username: string }> };

function serializeUser(row: NonNullable<ReturnType<typeof getAppUser>>) {
  return {
    username: row.username,
    role: row.role,
    active: row.active === 1,
    created_at: row.created_at,
  };
}

type PatchBody = {
  password?: string;
  role?: AppUserRole;
  active?: boolean;
};

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { username: raw } = await ctx.params;
  const username = normalizeUsername(raw);
  const row = getAppUser(username);
  if (!row) return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const self = normalizeUsername(auth.email);

  if (body.role && body.role !== "user" && body.role !== "admin") {
    return NextResponse.json({ error: "role non valido" }, { status: 400 });
  }

  const nextRole = body.role ?? row.role;
  const nextActive = body.active !== undefined ? (body.active ? 1 : 0) : (row.active as 0 | 1);

  if (username === self && nextActive === 0) {
    return NextResponse.json({ error: "Non puoi disabilitare te stesso" }, { status: 400 });
  }
  if (username === self && nextRole !== "admin") {
    return NextResponse.json({ error: "Non puoi rimuovere il tuo ruolo admin" }, { status: 400 });
  }
  if (row.role === "admin" && nextRole !== "admin" && countAppUsersByRole("admin") <= 1) {
    return NextResponse.json({ error: "Deve restare almeno un admin" }, { status: 400 });
  }

  const password_hash =
    body.password && body.password.length >= 6 ? hashPassword(body.password) : row.password_hash;

  upsertAppUser({
    username,
    password_hash,
    role: nextRole,
    active: nextActive,
    created_at: row.created_at,
  });

  const updated = getAppUser(username);
  return NextResponse.json({ ok: true, user: updated ? serializeUser(updated) : null });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { username: raw } = await ctx.params;
  const username = normalizeUsername(raw);
  const row = getAppUser(username);
  if (!row) return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });

  if (username === normalizeUsername(auth.email)) {
    return NextResponse.json({ error: "Non puoi eliminare te stesso" }, { status: 400 });
  }
  if (row.role === "admin" && countAppUsersByRole("admin") <= 1) {
    return NextResponse.json({ error: "Deve restare almeno un admin" }, { status: 400 });
  }

  deleteAppUser(username);
  return NextResponse.json({ ok: true });
}
