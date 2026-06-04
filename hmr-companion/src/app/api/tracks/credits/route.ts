import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getIngestCreditsInfo } from "@/lib/ingest-credits";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuthenticated();
  if (!auth) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  return NextResponse.json(getIngestCreditsInfo(auth.email));
}
