import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import {
  appendMessage,
  ensureChatSession,
  listMessages,
} from "@/lib/db";
import { runPlannerTurn } from "@/lib/claude-planner";

export const runtime = "nodejs";

function toPriorMessages(
  rows: { role: string; content: string }[]
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const recent = rows.slice(-24);
  for (const r of recent) {
    if (r.role !== "user" && r.role !== "assistant") continue;
    out.push({
      role: r.role as "user" | "assistant",
      content: r.content,
    });
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      sessionId: string;
      itineraryId: string | null;
      message: string;
    };
    const sessionId = body.sessionId?.trim();
    const message = body.message?.trim();
    if (!sessionId || !message) {
      return NextResponse.json({ error: "sessionId e message obbligatori" }, { status: 400 });
    }

    ensureChatSession(sessionId, body.itineraryId ?? null);

    const priorRows = listMessages(sessionId);
    const priorMessages = toPriorMessages(priorRows);

    appendMessage(sessionId, "user", message);

    const { reply, events, activeItineraryId } = await runPlannerTurn({
      userMessage: message,
      itineraryId: body.itineraryId ?? null,
      priorMessages,
    });

    appendMessage(sessionId, "assistant", reply);

    return NextResponse.json({ reply, events, activeItineraryId });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore chat" },
      { status: 500 }
    );
  }
}
