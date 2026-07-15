/** Legge JSON da fetch; messaggio chiaro se il server risponde HTML (es. 404 dev). */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const hint =
      res.status === 404
        ? "API non trovata — riavvia il dev server (npm run dev)"
        : `Risposta non JSON (${res.status})`;
    throw new Error(hint);
  }
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Errore ${res.status}`);
  }
  return data;
}
