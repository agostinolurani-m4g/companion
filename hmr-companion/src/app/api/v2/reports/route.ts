import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import {
  getFieldReport,
  hasActiveReportNearby,
  insertFieldReport,
  insertUserPhoto,
  listFieldReportsByAuthor,
  listFieldReportsInBbox,
} from "@/lib/db";
import { fieldReportsToGeoJson, isFieldReportKind, REPORT_KIND_LABELS } from "@/lib/field-reports";
import { serializeFieldReportForViewer } from "@/lib/field-reports-server";

export const runtime = "nodejs";

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
  kind?: string;
  description?: string;
  route_id?: string | null;
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

/** Corpo JSON oppure multipart (stessi campi + `file` con la foto). */
async function readPostBody(req: Request): Promise<{ body: PostBody; file: File | null }> {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return { body: {}, file: null };
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : undefined;
    };
    const file = form.get("file");
    return {
      body: {
        lng: str("lng") != null ? Number(str("lng")) : undefined,
        lat: str("lat") != null ? Number(str("lat")) : undefined,
        kind: str("kind"),
        description: str("description"),
        route_id: str("route_id") || null,
      },
      file: file instanceof File && file.size > 0 ? file : null,
    };
  }
  return { body: (await req.json().catch(() => ({}))) as PostBody, file: null };
}

export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { body, file } = await readPostBody(req);
  const lng = body.lng;
  const lat = body.lat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "lng e lat richiesti" }, { status: 400 });
  }
  if (!body.kind || !isFieldReportKind(body.kind)) {
    return NextResponse.json({ error: "kind non valido" }, { status: 400 });
  }
  if (hasActiveReportNearby(auth.email, lng!, lat!)) {
    return NextResponse.json(
      { error: "Hai già una segnalazione attiva nelle vicinanze" },
      { status: 400 },
    );
  }

  let photoExt: string | null = null;
  if (file) {
    photoExt = PHOTO_EXT[file.type] ?? null;
    if (!photoExt) {
      return NextResponse.json({ error: "Formato foto non supportato (JPEG, PNG, WebP, HEIC)" }, { status: 400 });
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "Foto troppo grande (max 5 MB)" }, { status: 400 });
    }
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const description = (body.description ?? "").trim();

  // La foto della segnalazione viene salvata come foto geolocalizzata dell'autore e collegata al report.
  let photoId: string | null = null;
  if (file && photoExt) {
    const relDir = path.join("data", "uploads", "v2", "photos", auth.email);
    fs.mkdirSync(path.join(process.cwd(), relDir), { recursive: true });
    photoId = crypto.randomUUID();
    const relPath = path.join(relDir, `${photoId}${photoExt}`).split(path.sep).join("/");
    fs.writeFileSync(path.join(process.cwd(), relPath), Buffer.from(await file.arrayBuffer()));
    insertUserPhoto({
      id: photoId,
      owner: auth.email,
      lng: lng!,
      lat: lat!,
      caption: `Segnalazione: ${REPORT_KIND_LABELS[body.kind]}${description ? ` — ${description.slice(0, 200)}` : ""}`,
      photo_path: relPath,
      route_id: body.route_id ?? null,
      created_at: now,
    });
  }

  const row = insertFieldReport({
    id,
    author: auth.email,
    lng: lng!,
    lat: lat!,
    kind: body.kind,
    description,
    route_id: body.route_id ?? null,
    photo_id: photoId,
    created_at: now,
    updated_at: now,
  });

  return NextResponse.json(
    { report: serializeFieldReportForViewer(row, auth.email) },
    { status: 201 },
  );
}
