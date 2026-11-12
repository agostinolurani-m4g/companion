import { NextResponse } from "next/server";
import { requireV2Beta } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ingestUploadedTracks } from "@/lib/activities/ingest";
import { parseActivityUpload, type ParseFailure, type ParsedTrack } from "@/lib/activities/parse-files";
import { isUserRouteActivity } from "@/lib/sports";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Upload di attività: GPX/TCX/FIT(.gz) singoli o ZIP (export Strava, Komoot, Garmin).
 * multipart: `files` (1..n), `sport` (default se il file non lo indica), `community` ("1"/"0").
 */
export async function POST(req: Request) {
  const auth = await requireV2Beta();
  if (!auth) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart/form-data richiesto" }, { status: 400 });

  const sportRaw = String(form.get("sport") ?? "hike");
  const defaultSport = isUserRouteActivity(sportRaw) ? sportRaw : "hike";
  const communityConsent = String(form.get("community") ?? "1") === "1";
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "Nessun file" }, { status: 400 });

  const tracks: ParsedTrack[] = [];
  const failures: ParseFailure[] = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      failures.push({ fileName: f.name, reason: "File oltre 200 MB" });
      continue;
    }
    const out = await parseActivityUpload(f.name, new Uint8Array(await f.arrayBuffer()));
    tracks.push(...out.tracks);
    failures.push(...out.failures);
  }

  const summary = ingestUploadedTracks(getDb(), auth.email, tracks, {
    defaultSport,
    communityConsent,
    now: Date.now(),
  });
  return NextResponse.json({
    imported: summary.imported,
    duplicates: summary.duplicates,
    ids: summary.ids,
    skipped: [...failures, ...summary.skipped].slice(0, 50),
    skipped_count: failures.length + summary.skipped.length,
  });
}
