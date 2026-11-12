import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  addFieldReportResolveVote,
  getAppUser,
  getFieldReport,
  resolveFieldReport,
} from "@/lib/db";
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

  const user = getAppUser(auth.email);
  const isAdmin = user?.role === "admin";
  const isAuthor = report.author === auth.email;

  if (isAuthor || isAdmin) {
    resolveFieldReport(id);
  } else {
    const { resolved, votes } = addFieldReportResolveVote(id, auth.email);
    if (!resolved && votes < 2) {
      return NextResponse.json({
        report: serializeFieldReportForViewer(getFieldReport(id)!, auth.email),
        pending_votes: votes,
        message: "Voto registrato. Servono 2 conferme per chiudere la segnalazione.",
      });
    }
  }

  const updated = getFieldReport(id)!;
  return NextResponse.json({ report: serializeFieldReportForViewer(updated, auth.email) });
}
