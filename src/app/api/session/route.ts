import { NextResponse } from "next/server";
import { createSession } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    let title: string | undefined;
    try {
      const body = await req.json();
      title = typeof body?.title === "string" ? body.title : undefined;
    } catch {
      /* empty */
    }
    const session = createSession(title);
    return NextResponse.json(session);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
