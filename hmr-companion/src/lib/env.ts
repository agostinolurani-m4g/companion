/** Chiave API https://openrouteservice.org (profili cycling/foot-hiking). */
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
