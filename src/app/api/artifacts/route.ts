import { NextResponse } from "next/server";
import { getSession, listArtifacts } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId") ?? "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId mancante" }, { status: 400 });
  }
  if (!getSession(sessionId)) {
    return NextResponse.json({ error: "Sessione non trovata" }, { status: 404 });
  }
  const rows = listArtifacts(sessionId);
  const items = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    created_at: r.created_at,
    payload: JSON.parse(r.payload) as unknown,
  }));
  return NextResponse.json({ items });
}
