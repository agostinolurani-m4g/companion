import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { addFieldReportConfirmation, getFieldReport } from "@/lib/db";
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
    return NextResponse.json({ error: "Segnalazione già risolta" }, { status: 400 });
  }
  if (report.author === auth.email) {
    return NextResponse.json({ error: "Non puoi confermare la tua segnalazione" }, { status: 400 });
  }

  const added = addFieldReportConfirmation(id, auth.email);
  if (!added) {
    return NextResponse.json({ error: "Hai già confermato" }, { status: 400 });
  }

  const updated = getFieldReport(id)!;
  return NextResponse.json({ report: serializeFieldReportForViewer(updated, auth.email) });
}
