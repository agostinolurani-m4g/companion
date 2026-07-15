import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { buildAvalancheMap } from "@/lib/avalanche-bulletin";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  try {
    const payload = await buildAvalancheMap();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=1800, s-maxage=3600" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore bollettino" },
      { status: 500 },
    );
  }
}
