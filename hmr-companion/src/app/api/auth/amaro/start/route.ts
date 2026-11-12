import { NextResponse } from "next/server";
import { amaroStartUrl } from "@/lib/amaro-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manda il tesserato all'area tesserati di Amaro, che lo riporta qui autenticato. */
export function GET() {
  return NextResponse.redirect(amaroStartUrl(), 303);
}
