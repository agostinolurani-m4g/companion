import Database from "better-sqlite3";
import { gzipSync, strToU8, zipSync } from "fflate";
import { FitBaseType, FitEncoder } from "fit-file-parser/encoder";
import { describe, expect, it } from "vitest";
import { ingestUploadedTracks } from "@/lib/activities/ingest";
import { computeTrackStats, parseActivityUpload, parseCsv } from "@/lib/activities/parse-files";
import { listActivities, migrateActivitiesStore } from "@/lib/activities/store";
import { mapFreeTextSport } from "@/lib/activities/sport-map";

function gpx(name: string, type: string | null, startIso: string, pts: [number, number, number][]): string {
  const t0 = Date.parse(startIso);
  return `<?xml version="1.0"?>
<gpx version="1.1" creator="komoot">
  <metadata><name>${name}</name><time>${startIso}</time></metadata>
  <trk><name>${name}</name>${type ? `<type>${type}</type>` : ""}<trkseg>
${pts.map(([lng, lat, ele], i) => `<trkpt lat="${lat}" lon="${lng}"><ele>${ele}</ele><time>${new Date(t0 + i * 60000).toISOString()}</time></trkpt>`).join("\n")}
  </trkseg></trk>
</gpx>`;
}

const PTS: [number, number, number][] = [
  [9.9, 46.3, 1000],
  [9.905, 46.302, 1050],
  [9.91, 46.304, 1120],
  [9.915, 46.306, 1100],
];

function tcx(startIso: string): string {
  const t0 = Date.parse(startIso);
  return `<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Lap><Track>
${PTS.map(([lng, lat, ele], i) => `<Trackpoint><Time>${new Date(t0 + i * 60000).toISOString()}</Time><Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lng}</LongitudeDegrees></Position><AltitudeMeters>${ele}</AltitudeMeters></Trackpoint>`).join("\n")}
</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
}

function fitFile(startIso: string): Uint8Array {
  const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180);
  const t0 = FitEncoder.toFitTimestamp(new Date(startIso));
  const enc = new FitEncoder();
  enc.writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 }]);
  PTS.forEach(([lng, lat, ele], i) => {
    enc.writeMessage(20, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: t0 + i * 60 },
      { number: 0, size: 4, baseType: FitBaseType.Sint32, value: semi(lat) },
      { number: 1, size: 4, baseType: FitBaseType.Sint32, value: semi(lng) },
      { number: 2, size: 2, baseType: FitBaseType.Uint16, value: Math.round((ele + 500) * 5) },
    ]);
  });
  enc.writeMessage(18, [
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: t0 },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 2 }, // cycling
    { number: 6, size: 1, baseType: FitBaseType.Enum, value: 8 }, // mountain
  ]);
  return enc.close();
}

describe("parse activity uploads", () => {
  it("GPX Komoot con nome, tipo e orari", async () => {
    const out = await parseActivityUpload("giro.gpx", strToU8(gpx("Anello Corna", "hike", "2026-10-01T07:00:00Z", PTS)));
    expect(out.failures).toEqual([]);
    expect(out.tracks).toHaveLength(1);
    const t = out.tracks[0];
    expect(t.name).toBe("Anello Corna");
    expect(t.sport).toBe("hike");
    expect(t.startTime).toBe(Date.parse("2026-10-01T07:00:00Z"));
    expect(t.points).toHaveLength(4);
  });

  it("TCX", async () => {
    const out = await parseActivityUpload("ride.tcx", strToU8(tcx("2026-10-02T07:00:00Z")));
    expect(out.tracks[0].sport).toBe("road");
    expect(out.tracks[0].points[2].ele).toBe(1120);
  });

  it("FIT (anche .fit.gz) con sport dalla sessione", async () => {
    const raw = fitFile("2026-10-03T07:00:00Z");
    for (const [name, bytes] of [
      ["a.fit", raw],
      ["a.fit.gz", gzipSync(raw)],
    ] as const) {
      const out = await parseActivityUpload(name, bytes);
      expect(out.failures).toEqual([]);
      const t = out.tracks[0];
      expect(t.sport).toBe("mtb");
      expect(t.points).toHaveLength(4);
      expect(t.points[0].lat).toBeCloseTo(46.3, 5);
      expect(t.points[0].lng).toBeCloseTo(9.9, 5);
      expect(t.points[1].ele).toBeCloseTo(1050, 0);
      expect(t.startTime).toBe(Date.parse("2026-10-03T07:00:00Z"));
    }
  });

  it("ZIP export Strava: usa activities.csv per nome e sport", async () => {
    const csv =
      'Activity ID,Activity Date,Activity Name,Activity Type,Filename\n' +
      '1,"Oct 1, 2026",Giro del lago,Ride,activities/1.gpx\n' +
      '2,"Oct 3, 2026","Scialpinismo, Pizzo",Backcountry Ski,activities/2.fit.gz\n';
    const zip = zipSync({
      "activities.csv": strToU8(csv),
      "activities/1.gpx": strToU8(gpx("x", null, "2026-10-01T07:00:00Z", PTS)),
      "activities/2.fit.gz": gzipSync(fitFile("2026-10-03T07:00:00Z")),
      "media/photo.jpg": new Uint8Array([1, 2, 3]),
    });
    const out = await parseActivityUpload("export_123.zip", zip);
    expect(out.failures).toEqual([]);
    const byName = Object.fromEntries(out.tracks.map((t) => [t.name, t.sport]));
    expect(byName).toEqual({ "Giro del lago": "road", "Scialpinismo, Pizzo": "ski" });
  });

  it("formato non supportato", async () => {
    const out = await parseActivityUpload("foto.jpg", new Uint8Array([1]));
    expect(out.tracks).toHaveLength(0);
    expect(out.failures[0].reason).toMatch(/non supportato/);
  });

  it("CSV con virgolette ed escape", () => {
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3')).toEqual([
      ["a", "b,c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });

  it("statistiche: distanza e dislivello con isteresi", () => {
    const s = computeTrackStats(PTS.map(([lng, lat, ele], i) => ({ lng, lat, ele, t: i * 60000 })));
    expect(s.distance_m).toBeGreaterThan(1000);
    expect(s.elev_gain_m).toBe(120);
    expect(s.moving_time_s).toBe(180);
  });

  it("mapping testi sport", () => {
    expect(mapFreeTextSport("Backcountry Ski")).toBe("ski");
    expect(mapFreeTextSport("touringbicycle")).toBe("road");
    expect(mapFreeTextSport("mtb_easy")).toBe("mtb");
    expect(mapFreeTextSport("Trail Run")).toBe("trail_run");
    expect(mapFreeTextSport("Alpine Ski")).toBeNull();
    expect(mapFreeTextSport("")).toBeNull();
  });
});

describe("ingest uploads", () => {
  it("dedup dello stesso giro caricato come GPX e come FIT", async () => {
    const db = new Database(":memory:");
    migrateActivitiesStore(db);
    const a = await parseActivityUpload("a.gpx", strToU8(gpx("A", null, "2026-10-03T07:00:00Z", PTS)));
    const b = await parseActivityUpload("a.fit", fitFile("2026-10-03T07:00:00Z"));
    const now = Date.parse("2026-10-05T00:00:00Z");
    const r1 = ingestUploadedTracks(db, "ale", a.tracks, { defaultSport: "hike", communityConsent: true, now });
    const r2 = ingestUploadedTracks(db, "ale", b.tracks, { defaultSport: "hike", communityConsent: true, now });
    expect(r1.imported).toBe(1);
    expect(r2.duplicates).toBe(1);
    const rows = listActivities(db, "ale");
    expect(rows).toHaveLength(1);
    expect(rows[0].review_state).toBe("pending");
    expect(rows[0].community_consent).toBe(1);
    expect(rows[0].heat_scopes).toBe("u:ale,community");
  });
});
