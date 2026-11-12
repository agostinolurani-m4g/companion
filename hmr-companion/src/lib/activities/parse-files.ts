import crypto from "node:crypto";
import { gunzipSync, strFromU8, unzipSync } from "fflate";
import FitParser from "fit-file-parser";
import { parseGpxTrackpoints } from "@/lib/gpx";
import type { UserRouteActivity } from "@/lib/sports";
import { compactLine, haversineM } from "./geo";
import { mapFitSport, mapFreeTextSport } from "./sport-map";

export { compactLine, haversineM };

/**
 * Parsing di file attività caricati dall'utente: GPX (Komoot, Garmin, export
 * vari), TCX, FIT (anche .gz) e ZIP (export completo Strava / Komoot / Garmin).
 */

export type TrackPoint = { lng: number; lat: number; ele?: number; t?: number };

export type ParsedTrack = {
  fileName: string;
  name: string;
  sport: UserRouteActivity | null;
  startTime: number | null;
  points: TrackPoint[];
};

export type ParseFailure = { fileName: string; reason: string };

export type ParseOutcome = { tracks: ParsedTrack[]; failures: ParseFailure[] };

const MAX_ZIP_ENTRIES = 5000;

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function stripExt(name: string): string {
  return name.replace(/\.(gpx|tcx|fit)(\.gz)?$/i, "");
}

function validPoint(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

export function parseGpxActivity(xml: string, fileName: string): ParsedTrack | null {
  const raw = parseGpxTrackpoints(xml);
  const points: TrackPoint[] = [];
  for (const p of raw) {
    if (!validPoint(p.lat, p.lng)) continue;
    const t = p.timeIso ? Date.parse(p.timeIso) : NaN;
    points.push({ lng: p.lng, lat: p.lat, ele: p.eleM, t: Number.isFinite(t) ? t : undefined });
  }
  if (points.length < 2) return null;
  const trk = /<trk\b[^>]*>([\s\S]*?)<trkseg/i.exec(xml)?.[1] ?? "";
  const name =
    /<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/i.exec(trk)?.[1]?.trim() ||
    /<metadata>[\s\S]*?<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/i.exec(xml)?.[1]?.trim() ||
    stripExt(baseName(fileName));
  const type = /<type>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/type>/i.exec(trk)?.[1] ?? null;
  const metaTime = /<metadata>[\s\S]*?<time>([^<]+)<\/time>/i.exec(xml)?.[1];
  const startTime = points[0].t ?? (metaTime ? Date.parse(metaTime) : NaN);
  return {
    fileName,
    name: decodeXmlEntities(name),
    sport: mapFreeTextSport(type),
    startTime: Number.isFinite(startTime) ? startTime : null,
    points,
  };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// TCX
// ---------------------------------------------------------------------------

export function parseTcxActivity(xml: string, fileName: string): ParsedTrack | null {
  const points: TrackPoint[] = [];
  const tp = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/gi;
  let m: RegExpExecArray | null;
  while ((m = tp.exec(xml)) !== null) {
    const inner = m[1];
    const lat = parseFloat(/<LatitudeDegrees>([^<]+)<\/LatitudeDegrees>/i.exec(inner)?.[1] ?? "");
    const lng = parseFloat(/<LongitudeDegrees>([^<]+)<\/LongitudeDegrees>/i.exec(inner)?.[1] ?? "");
    if (!validPoint(lat, lng)) continue;
    const ele = parseFloat(/<AltitudeMeters>([^<]+)<\/AltitudeMeters>/i.exec(inner)?.[1] ?? "");
    const t = Date.parse(/<Time>([^<]+)<\/Time>/i.exec(inner)?.[1] ?? "");
    points.push({
      lng,
      lat,
      ele: Number.isFinite(ele) ? ele : undefined,
      t: Number.isFinite(t) ? t : undefined,
    });
  }
  if (points.length < 2) return null;
  const sport = /<Activity\s+Sport="([^"]+)"/i.exec(xml)?.[1] ?? null;
  const name = /<Notes>([^<]+)<\/Notes>/i.exec(xml)?.[1]?.trim() || stripExt(baseName(fileName));
  return {
    fileName,
    name: decodeXmlEntities(name),
    sport: sport && sport.toLowerCase() !== "other" ? mapFreeTextSport(sport) : null,
    startTime: points[0].t ?? null,
    points,
  };
}

// ---------------------------------------------------------------------------
// FIT
// ---------------------------------------------------------------------------

type FitRecord = { position_lat?: number; position_long?: number; altitude?: number; enhanced_altitude?: number; timestamp?: unknown };

function toMs(v: unknown): number | undefined {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" || typeof v === "number") {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

export async function parseFitActivity(bytes: Uint8Array, fileName: string): Promise<ParsedTrack | null> {
  const parser = new FitParser({ force: true, mode: "list", lengthUnit: "m", speedUnit: "m/s" });
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const data = (await parser.parseAsync(ab)) as unknown as {
    records?: FitRecord[];
    sessions?: { sport?: unknown; sub_sport?: unknown; start_time?: unknown }[];
  };
  const points: TrackPoint[] = [];
  for (const r of data.records ?? []) {
    const lat = r.position_lat;
    const lng = r.position_long;
    if (typeof lat !== "number" || typeof lng !== "number" || !validPoint(lat, lng)) continue;
    const ele = r.enhanced_altitude ?? r.altitude;
    points.push({ lng, lat, ele: typeof ele === "number" ? ele : undefined, t: toMs(r.timestamp) });
  }
  if (points.length < 2) return null;
  const session = data.sessions?.[0];
  return {
    fileName,
    name: stripExt(baseName(fileName)),
    sport: session ? mapFitSport(session.sport, session.sub_sport) : null,
    startTime: toMs(session?.start_time) ?? points[0].t ?? null,
    points,
  };
}

// ---------------------------------------------------------------------------
// CSV export Strava (activities.csv) → metadati per filename
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

type ExportMeta = { name: string; type: string };

function stravaExportMeta(csvText: string): Map<string, ExportMeta> {
  const rows = parseCsv(csvText);
  const out = new Map<string, ExportMeta>();
  if (rows.length < 2) return out;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iName = header.indexOf("activity name");
  const iType = header.indexOf("activity type");
  const iFile = header.indexOf("filename");
  if (iFile < 0) return out;
  for (const r of rows.slice(1)) {
    const file = r[iFile]?.trim();
    if (!file) continue;
    out.set(baseName(file).toLowerCase(), { name: iName >= 0 ? r[iName] ?? "" : "", type: iType >= 0 ? r[iType] ?? "" : "" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function parseSingle(name: string, bytes: Uint8Array): Promise<ParsedTrack | null> {
  const lower = name.toLowerCase();
  let data = bytes;
  let effective = lower;
  if (lower.endsWith(".gz")) {
    data = gunzipSync(bytes);
    effective = lower.slice(0, -3);
  }
  if (effective.endsWith(".gpx")) return parseGpxActivity(strFromU8(data), name);
  if (effective.endsWith(".tcx")) return parseTcxActivity(strFromU8(data).trimStart(), name);
  if (effective.endsWith(".fit")) return parseFitActivity(data, name);
  return null;
}

function isTrackFile(name: string): boolean {
  return /\.(gpx|tcx|fit)(\.gz)?$/i.test(name);
}

/** Analizza un file caricato (singolo o ZIP). Non lancia: raccoglie i fallimenti. */
export async function parseActivityUpload(fileName: string, bytes: Uint8Array): Promise<ParseOutcome> {
  const tracks: ParsedTrack[] = [];
  const failures: ParseFailure[] = [];

  if (/\.zip$/i.test(fileName)) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes, {
        filter: (f) => isTrackFile(f.name) || /(^|\/)activities\.csv$/i.test(f.name),
      });
    } catch (e) {
      return { tracks, failures: [{ fileName, reason: `ZIP non leggibile: ${(e as Error).message}` }] };
    }
    const names = Object.keys(entries);
    const csvName = names.find((n) => /(^|\/)activities\.csv$/i.test(n));
    const meta = csvName ? stravaExportMeta(strFromU8(entries[csvName])) : new Map<string, ExportMeta>();
    const trackNames = names.filter(isTrackFile).slice(0, MAX_ZIP_ENTRIES);
    for (const n of trackNames) {
      try {
        const t = await parseSingle(n, entries[n]);
        if (!t) {
          failures.push({ fileName: n, reason: "Nessun punto GPS" });
          continue;
        }
        const m = meta.get(baseName(n).toLowerCase());
        if (m) {
          if (m.name.trim()) t.name = m.name.trim();
          t.sport = mapFreeTextSport(m.type) ?? t.sport;
        }
        tracks.push(t);
      } catch (e) {
        failures.push({ fileName: n, reason: (e as Error).message || String(e) });
      }
    }
    if (trackNames.length === 0) failures.push({ fileName, reason: "Lo ZIP non contiene file GPX/TCX/FIT" });
    return { tracks, failures };
  }

  if (!isTrackFile(fileName)) {
    return { tracks, failures: [{ fileName, reason: "Formato non supportato (usa GPX, TCX, FIT o ZIP)" }] };
  }
  try {
    const t = await parseSingle(fileName, bytes);
    if (t) tracks.push(t);
    else failures.push({ fileName, reason: "Nessun punto GPS" });
  } catch (e) {
    failures.push({ fileName, reason: (e as Error).message || String(e) });
  }
  return { tracks, failures };
}

// ---------------------------------------------------------------------------
// Statistiche + normalizzazione
// ---------------------------------------------------------------------------

export type TrackStats = { distance_m: number; elev_gain_m: number; moving_time_s: number | null };

export function computeTrackStats(points: TrackPoint[]): TrackStats {
  let dist = 0;
  let gain = 0;
  let moving = 0;
  let hasTime = false;
  // Isteresi di 3 m sul dislivello per non sommare il rumore del GPS/barometro.
  let refEle: number | undefined = points.find((p) => p.ele != null)?.ele;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = haversineM(a.lng, a.lat, b.lng, b.lat);
    dist += d;
    if (b.ele != null && refEle != null) {
      if (b.ele - refEle >= 3) {
        gain += b.ele - refEle;
        refEle = b.ele;
      } else if (refEle - b.ele >= 3) {
        refEle = b.ele;
      }
    }
    if (a.t != null && b.t != null && b.t > a.t) {
      hasTime = true;
      const dt = (b.t - a.t) / 1000;
      // Conta come "in movimento" se velocità > 0.5 m/s e pausa < 5 min.
      if (dt < 300 && d / dt > 0.5) moving += dt;
    }
  }
  return {
    distance_m: Math.round(dist),
    elev_gain_m: Math.round(gain),
    moving_time_s: hasTime ? Math.round(moving) : null,
  };
}

/** Id stabile per deduplicare lo stesso giro caricato più volte (anche da formati diversi). */
export function uploadExternalId(track: Pick<ParsedTrack, "points" | "startTime">): string {
  const first = track.points[0];
  const last = track.points[track.points.length - 1];
  const startMin = track.startTime != null ? Math.floor(track.startTime / 60000) : "na";
  const key = [
    startMin,
    first.lat.toFixed(4),
    first.lng.toFixed(4),
    last.lat.toFixed(4),
    last.lng.toFixed(4),
  ].join("|");
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 24);
}
