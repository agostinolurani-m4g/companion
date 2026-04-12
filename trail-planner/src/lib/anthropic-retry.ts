import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";

const RETRY_STATUS = new Set([429, 503, 529]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(e: unknown): boolean {
  if (!(e instanceof APIError)) return false;
  if (typeof e.status === "number" && RETRY_STATUS.has(e.status)) return true;
  if (e.type === "overloaded_error" || e.type === "rate_limit_error") return true;
  return false;
}

/** Più tentativi con attesa esponenziale per 429/503/529 (overload Anthropic). */
export async function messagesCreateWithRetry(
  client: Anthropic,
  params: Parameters<Anthropic["messages"]["create"]>[0],
  maxAttempts = 5
): Promise<Message> {
  const nonStream = { ...params, stream: false as const };
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const out = await client.messages.create(nonStream);
      return out as Message;
    } catch (e) {
      last = e;
      if (!isRetryable(e) || attempt === maxAttempts) throw e;
      const delay = Math.min(25_000, 2000 * Math.pow(2, attempt - 1));
      await sleep(delay);
    }
  }
  throw last;
}

export function formatAnthropicErrorForUser(e: unknown): string {
  if (e instanceof APIError) {
    if (e.status === 529 || e.type === "overloaded_error") {
      return (
        "I server Anthropic sono sovraccarichi (errore 529 / overloaded). " +
        "Riprova tra 1–2 minuti. La mappa, le tappe manuali e il pulsante «Traccia su strada» funzionano comunque senza la chat."
      );
    }
    if (e.status === 429 || e.type === "rate_limit_error") {
      return "Limite di richieste Anthropic raggiunto. Attendi un minuto e riprova.";
    }
    return `Errore API (${String(e.status ?? "?")}): ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return "Errore nella chat AI.";
}
