import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/admin/ingest — stub protetto.
 *
 * Il lavoro vero gira offline via `npm run ingest && npm run snapshot`.
 * Questo endpoint si limita a verificare il token e a rispondere con istruzioni,
 * così non esponiamo un operatore Overpass interattivo al pubblico.
 */
export async function POST(req: Request) {
  const token = process.env.INGEST_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { error: "INGEST_TOKEN non configurato" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const headerToken = req.headers.get("x-ingest-token")?.trim();
  const provided = auth || headerToken;
  if (provided !== token) {
    return NextResponse.json({ error: "token non valido" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    message:
      "Esegui `npm run seed` (ingest + snapshot Overpass) sulla macchina che ospita il DB. Questo endpoint è solo di controllo token.",
  });
}
