import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { syncStravaAccount } from "@/lib/integrations/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

/** "Sincronizza ora". */
export async function POST() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const r = await syncStravaAccount(getDb(), auth.email);
  return NextResponse.json(r, { status: r.error === "Strava non collegato" ? 404 : 200 });
}
