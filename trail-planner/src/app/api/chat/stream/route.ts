import type Anthropic from "@anthropic-ai/sdk";
import {
  appendMessage,
  ensureChatSession,
  listMessages,
} from "@/lib/db";
import { runPlannerTurn, type PlannerProgressEvent } from "@/lib/claude-planner";

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
  const body = (await req.json()) as {
    sessionId: string;
    itineraryId: string | null;
    message: string;
  };
  const sessionId = body.sessionId?.trim();
  const message = body.message?.trim();
  if (!sessionId || !message) {
    return new Response(JSON.stringify({ error: "sessionId e message obbligatori" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  ensureChatSession(sessionId, body.itineraryId ?? null);
  const priorRows = listMessages(sessionId);
  const priorMessages = toPriorMessages(priorRows);
  appendMessage(sessionId, "user", message);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        const result = await runPlannerTurn({
          userMessage: message,
          itineraryId: body.itineraryId ?? null,
          priorMessages,
          onProgress: (e: PlannerProgressEvent) => {
            if (e.type === "assistant_text") {
              send({ type: "progress", kind: "assistant_text", text: e.text });
            } else {
              send({
                type: "progress",
                kind: "tool",
                name: e.name,
                inputSummary: e.inputSummary,
              });
            }
          },
        });
        appendMessage(sessionId, "assistant", result.reply);
        send({
          type: "complete",
          reply: result.reply,
          events: result.events,
          activeItineraryId: result.activeItineraryId,
        });
      } catch (e) {
        console.error(e);
        send({
          type: "error",
          message: e instanceof Error ? e.message : "Errore chat",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
