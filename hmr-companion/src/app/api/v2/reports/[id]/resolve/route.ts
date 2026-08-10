import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getFieldReport, resolveFieldReport } from "@/lib/db";
import { serializeFieldReportForViewer } from "@/lib/field-reports-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { id } = await ctx.params;
  const report = getFieldReport(id);
  if (!report) return NextResponse.json({ error: "Segnalazione non trovata" }, { status: 404 });
  if (report.status !== "active") {
    return NextResponse.json({ error: "Già risolta" }, { status: 400 });
  }

  resolveFieldReport(id);
  const updated = getFieldReport(id)!;
  return NextResponse.json({ report: serializeFieldReportForViewer(updated, auth.email) });
}
