import { after, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handleStravaWebhookEvent, type StravaWebhookEvent } from "@/lib/integrations/sync";

export const runtime = "nodejs";

/**
 * Webhook Strava (push subscription). Serve un URL pubblico. Registrazione una tantum:
 *   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
 *     -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
 *     -F callback_url=$APP_BASE_URL/api/v2/integrations/strava/webhook \
 *     -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN?.trim();
  if (
    url.searchParams.get("hub.mode") !== "subscribe" ||
    !expected ||
    url.searchParams.get("hub.verify_token") !== expected
  ) {
    return NextResponse.json({ error: "verify token non valido" }, { status: 403 });
  }
  return NextResponse.json({ "hub.challenge": url.searchParams.get("hub.challenge") ?? "" });
}

export async function POST(req: Request) {
  const ev = (await req.json().catch(() => null)) as StravaWebhookEvent | null;
  if (!ev || !ev.object_type || !ev.owner_id) return NextResponse.json({ ok: true });
  // Strava vuole una risposta entro 2 s: elaboriamo dopo.
  after(async () => {
    try {
      await handleStravaWebhookEvent(getDb(), ev);
    } catch (e) {
      console.warn("[strava] webhook", e);
    }
  });
  return NextResponse.json({ ok: true });
}
