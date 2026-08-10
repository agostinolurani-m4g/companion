import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  getFieldReport,
  hasActiveReportNearby,
  insertFieldReport,
  listFieldReportsByAuthor,
  listFieldReportsInBbox,
} from "@/lib/db";
import type { FieldReportKind } from "@/lib/field-reports";
import { fieldReportsToGeoJson } from "@/lib/field-reports";
import { serializeFieldReportForViewer } from "@/lib/field-reports-server";

export const runtime = "nodejs";

const VALID_KINDS = new Set<FieldReportKind>([
  "avalanche",
  "road_closed",
  "steep",
  "bridge_down",
  "trail_blocked",
  "water",
  "other",
]);

export async function GET(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const url = new URL(req.url);
  const bbox = url.searchParams.get("bbox");

  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
      return NextResponse.json({ error: "bbox non valido" }, { status: 400 });
    }
    const [south, west, north, east] = parts;
    const rows = listFieldReportsInBbox(south, west, north, east, true);
    const reports = rows.map((r) => serializeFieldReportForViewer(r, auth.email));
    return NextResponse.json({ reports, geojson: fieldReportsToGeoJson(reports) });
  }

  const author = (url.searchParams.get("author") ?? auth.email).trim().toLowerCase();
  const rows = listFieldReportsByAuthor(author);
  return NextResponse.json({
    reports: rows.map((r) => serializeFieldReportForViewer(r, auth.email)),
  });
}

type PostBody = {
  lng?: number;
  lat?: number;
  kind?: FieldReportKind;
  description?: string;
  route_id?: string | null;
};

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const lng = body.lng;
  const lat = body.lat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "lng e lat richiesti" }, { status: 400 });
  }
  if (!body.kind || !VALID_KINDS.has(body.kind)) {
    return NextResponse.json({ error: "kind non valido" }, { status: 400 });
  }
  if (hasActiveReportNearby(auth.email, lng!, lat!)) {
    return NextResponse.json(
      { error: "Hai già una segnalazione attiva nelle vicinanze" },
      { status: 400 },
    );
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const row = insertFieldReport({
    id,
    author: auth.email,
    lng: lng!,
    lat: lat!,
    kind: body.kind,
    description: (body.description ?? "").trim(),
    route_id: body.route_id ?? null,
    created_at: now,
    updated_at: now,
  });

  return NextResponse.json(
    { report: serializeFieldReportForViewer(row, auth.email) },
    { status: 201 },
  );
}
