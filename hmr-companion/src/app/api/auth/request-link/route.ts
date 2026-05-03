import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  createMagicLinkExpiry,
  createOpaqueToken,
  getAuthBaseUrl,
  isAllowedEmail,
  normalizeEmail,
  hashToken,
} from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/auth-email";
import { insertAuthMagicLink } from "@/lib/db";

export const runtime = "nodejs";

type PostBody = { email?: string };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PostBody;
  const email = normalizeEmail(body.email ?? "");
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Email non valida" }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: "Email non autorizzata" }, { status: 403 });
  }

  try {
    const now = Date.now();
    const token = createOpaqueToken();
    const expiresAt = createMagicLinkExpiry(now);
    insertAuthMagicLink({
      id: crypto.randomUUID(),
      email,
      token_hash: hashToken(token),
      expires_at: expiresAt,
      created_at: now,
    });

    const magicLinkUrl = `${getAuthBaseUrl()}/api/auth/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLinkEmail({ to: email, magicLinkUrl, expiresInMinutes: 15 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Invio email non configurato. Imposta RESEND_API_KEY." },
      { status: 500 }
    );
  }
}
