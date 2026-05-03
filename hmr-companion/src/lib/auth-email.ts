import { Resend } from "resend";

let resendClient: Resend | null = null;

/** Accesso dinamico: così Next non inlines la chiave al build Docker (dove env è vuota). */
function envStr(key: string): string | undefined {
  return process.env[key]?.trim();
}

function getResendClient(): Resend {
  if (resendClient) return resendClient;
  const apiKey = envStr("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY mancante");
  resendClient = new Resend(apiKey);
  return resendClient;
}

export async function sendMagicLinkEmail(input: {
  to: string;
  magicLinkUrl: string;
  expiresInMinutes: number;
}) {
  const from =
    envStr("HMR_AUTH_FROM_EMAIL") || "HMR Companion <onboarding@resend.dev>";
  const resend = getResendClient();
  await resend.emails.send({
    from,
    to: input.to,
    subject: "Accesso HMR Companion",
    text: `Apri questo link per accedere a HMR Companion:\n${input.magicLinkUrl}\n\nIl link scade tra ${input.expiresInMinutes} minuti.`,
  });
}
