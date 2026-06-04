import { NextResponse } from "next/server";
import path from "node:path";
import { requireAuthenticated } from "@/lib/auth";
import {
  assertCanIngest,
  consumeIngestCredit,
  getIngestCreditsInfo,
} from "@/lib/ingest-credits";
import { runFullTrackSnapshot } from "@/lib/run-track-snapshot";
import { countPois } from "@/lib/db";
import {
  displayNameFromGpxFilename,
  HMR_OFFICIAL_TRACK_ID,
  ingestGpxToDb,
  resolveUniqueTrackId,
  trackExists,
} from "@/lib/track-ingest";

export const runtime = "nodejs";
export const maxDuration = 900;

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

  const hmrOfficial = form.get("hmrOfficial") === "1" || form.get("hmrOfficial") === "true";
  const nameField = String(form.get("name") ?? "").trim();
  const displayName = nameField || displayNameFromGpxFilename(file.name);

  let trackId: string;
  if (hmrOfficial) {
    trackId = HMR_OFFICIAL_TRACK_ID;
  } else {
    trackId = resolveUniqueTrackId(displayName, trackExists);
  }

  const gpxRelPath =
    trackId === HMR_OFFICIAL_TRACK_ID
      ? "data/Hellenic_Mountain_Race_2026.gpx"
      : path.posix.join("data", "uploads", `${trackId}.gpx`);

  try {
    assertCanIngest(auth.email);

    const result = ingestGpxToDb({
      xml,
      trackId,
      name: hmrOfficial ? "Hellenic Mountain Race 2026" : displayName,
      gpxRelPath,
      seedHmrCourseMarkers: hmrOfficial,
      persistGpxFile: true,
    });

    const { poiCount: snapshotPoiCount } = await runFullTrackSnapshot(trackId, {
      webFast: true,
    });

    consumeIngestCredit(auth.email);
    const creditsAfter = getIngestCreditsInfo(auth.email);
    const poiCount = snapshotPoiCount || countPois(trackId);

    return NextResponse.json({
      trackId: result.trackId,
      name: result.name,
      length_km: result.length_km,
      elev_gain_m: result.elev_gain_m,
      elev_loss_m: result.elev_loss_m,
      updated: result.updated,
      snapshotComplete: true,
      poiCount,
      credits: creditsAfter,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore import GPX";
    const status = msg.includes("Credito ingest") ? 402 : 500;
    return NextResponse.json({ error: msg, credits: getIngestCreditsInfo(auth.email) }, { status });
  }
}
