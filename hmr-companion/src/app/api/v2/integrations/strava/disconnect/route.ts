import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { disconnectStrava } from "@/lib/integrations/sync";

export const runtime = "nodejs";

/** Revoca l'accesso e cancella attività + heatmap Strava (richiesto dall'accordo API). */
export async function POST() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const r = await disconnectStrava(getDb(), auth.email);
  return NextResponse.json({ ok: true, ...r });
}
