import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listNotifications, markNotificationsRead, unreadCount } from "@/lib/notifications";

export const runtime = "nodejs";

/** GET → ultime notifiche e quante non lette. */
export async function GET() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const db = getDb();
  return NextResponse.json({ notifications: listNotifications(db, auth.email), unread: unreadCount(db, auth.email) });
}

/** POST { ids?: string[] } → segna come lette (tutte se senza ids). */
export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 100) : undefined;
  const db = getDb();
  markNotificationsRead(db, auth.email, Date.now(), ids);
  return NextResponse.json({ ok: true, unread: unreadCount(db, auth.email) });
}
