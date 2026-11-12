import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { countActivitiesByProvider, getExternalAccount } from "@/lib/activities/store";
import { stravaConfig } from "@/lib/integrations/strava";
import { isStravaSyncRunning } from "@/lib/integrations/sync";

export const runtime = "nodejs";

/** Stato dei collegamenti esterni dell'utente corrente. */
export async function GET() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const db = getDb();
  const acc = getExternalAccount(db, auth.email, "strava");
  const counts = countActivitiesByProvider(db, auth.email);
  return NextResponse.json({
    strava: {
      configured: stravaConfig() != null,
      connected: !!acc,
      athlete_name: acc?.athlete_name ?? null,
      status: acc?.status ?? null,
      last_sync_at: acc?.last_sync_at ?? null,
      last_error: acc?.last_error ?? null,
      syncing: isStravaSyncRunning(auth.email),
      activities: counts.strava ?? 0,
    },
    uploads: { activities: counts.upload ?? 0 },
  });
}
