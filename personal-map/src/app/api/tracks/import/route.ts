import { NextResponse } from "next/server";
import path from "node:path";
import { requireAuthenticated } from "@/lib/auth";
import { assertCanIngest, getIngestCreditsInfo } from "@/lib/ingest-credits";
import {
  displayNameFromGpxFilename,
  ingestGpxToDb,
  resolveUniqueTrackId,
  trackExists,
} from "@/lib/track-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await requireAuthenticated();
  if (!auth) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const creditsBefore = getIngestCreditsInfo(auth.email);
  if (!creditsBefore.canIngest) {
    return NextResponse.json(
      { error: "Credito ingest esaurito.", credits: creditsBefore },
      { status: 402 }
    );
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BYTES) {
    return NextResponse.json({ error: "File troppo grande (max 50 MB)" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Richiesta multipart non valida" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo file (.gpx) richiesto" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".gpx")) {
    return NextResponse.json({ error: "Solo file .gpx" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File troppo grande (max 50 MB)" }, { status: 413 });
  }

  const xml = await file.text();
  if (!xml.trim()) {
    return NextResponse.json({ error: "GPX vuoto" }, { status: 400 });
  }

  const nameField = String(form.get("name") ?? "").trim();
  const activityType = String(form.get("activityType") ?? "").trim() || null;
  const displayName = nameField || displayNameFromGpxFilename(file.name);
  const trackId = resolveUniqueTrackId(displayName, trackExists);
  const gpxRelPath = path.posix.join("data", "uploads", `${trackId}.gpx`);

  try {
    assertCanIngest(auth.email);

    const result = ingestGpxToDb({
      xml,
      trackId,
      name: displayName,
      ownerId: auth.email,
      gpxRelPath,
      activityType,
      persistGpxFile: true,
    });

    return NextResponse.json({
      trackId: result.trackId,
      name: result.name,
      length_km: result.length_km,
      elev_gain_m: result.elev_gain_m,
      elev_loss_m: result.elev_loss_m,
      updated: result.updated,
      gpxOnly: true,
      credits: getIngestCreditsInfo(auth.email),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore import GPX";
    const status = msg.includes("Credito ingest") ? 402 : 500;
    return NextResponse.json({ error: msg, credits: getIngestCreditsInfo(auth.email) }, { status });
  }
}
