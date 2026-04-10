import { NextResponse } from "next/server";
import { addMessage, getSession } from "@/lib/db";
import { runAgentTurn } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!sessionId || !message) {
      return NextResponse.json(
        { error: "sessionId e message obbligatori" },
        { status: 400 }
      );
    }
    if (!getSession(sessionId)) {
      return NextResponse.json({ error: "Sessione non trovata" }, { status: 404 });
    }
    addMessage(sessionId, "user", message);
    const { text, usage } = await runAgentTurn(sessionId);
    addMessage(sessionId, "assistant", text);
    return NextResponse.json({ reply: text, usage });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
