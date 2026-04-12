/**
 * Legge la chiave Anthropic in modo tollerante (spazi, virgolette).
 * La variabile deve essere in `.env.local` nella root del progetto Next (accanto a `package.json`),
 * non in altre cartelle (es. un altro repo).
 */
export function getAnthropicApiKey(): string | undefined {
  const raw = process.env.ANTHROPIC_API_KEY;
  if (raw == null || typeof raw !== "string") return undefined;
  let v = raw.trim();
  if (!v) return undefined;
  // Rimuove virgolette se l'intero valore è quotato
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v || undefined;
}

/** Chiave API https://openrouteservice.org (profilo foot-hiking per sentieri). */
export function getOpenRouteServiceApiKey(): string | undefined {
  const raw = process.env.OPENROUTESERVICE_API_KEY;
  if (raw == null || typeof raw !== "string") return undefined;
  let v = raw.trim();
  if (!v) return undefined;
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v || undefined;
}
