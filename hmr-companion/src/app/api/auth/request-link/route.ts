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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auth/request-link]", msg);
    if (/RESEND_API_KEY mancante/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "RESEND_API_KEY non visibile al processo Next.js. Rebuild immagine dopo aver aggiornato docker-compose (env a runtime) oppure verifica bug inline env.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      {
        error:
          msg.length > 0 && msg.length < 280
            ? `Invio email fallito: ${msg}`
            : "Invio email fallito. Controlla log server e configurazione Resend (mittente, dominio).",
      },
      { status: 500 }
    );
  }
}
