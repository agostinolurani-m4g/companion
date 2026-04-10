import { NextResponse } from "next/server";
import { getSession, listMessages } from "@/lib/db";

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
  const messages = listMessages(sessionId);
  return NextResponse.json({ messages });
}
