import { Resend } from "resend";

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY mancante");
  resendClient = new Resend(apiKey);
  return resendClient;
}

export async function sendMagicLinkEmail(input: {
  to: string;
  magicLinkUrl: string;
  expiresInMinutes: number;
}) {
  const from = process.env.HMR_AUTH_FROM_EMAIL?.trim() || "HMR Companion <onboarding@resend.dev>";
  const resend = getResendClient();
  await resend.emails.send({
    from,
    to: input.to,
    subject: "Accesso HMR Companion",
    text: `Apri questo link per accedere a HMR Companion:\n${input.magicLinkUrl}\n\nIl link scade tra ${input.expiresInMinutes} minuti.`,
  });
}
