import type { Database as SqliteDatabase } from "better-sqlite3";
import type { Position } from "geojson";
import { nearestPointOnPolyline, positionAtKm } from "@/lib/track-geometry";
import {
  STATIC_BRIDGES,
  STATIC_RESUPPLY,
  STATIC_SECTIONS,
  type StaticSectionSeed,
} from "@/lib/seed-static";

export type ReseedCourseMarkersResult = {
  resupply: number;
  bridges: number;
  sections: number;
};

function resolveSectionKm(
  s: StaticSectionSeed,
  simplified: Position[],
  cum: number[],
  totalKm: number,
  log: (msg: string) => void
): { km_start: number; km_end: number } {
  let kmStart = s.km_start;
  let kmEnd = s.km_end;
  if (s.anchor_lat != null && s.anchor_lng != null) {
    const nearest = nearestPointOnPolyline(simplified, [s.anchor_lng, s.anchor_lat], cum);
    if (nearest) {
      const half = (s.span_km ?? 2) / 2;
      kmStart = Math.max(0, nearest.alongKm - half);
      kmEnd = Math.min(totalKm, nearest.alongKm + half);
      log(
        `${s.label}: km ${kmStart.toFixed(1)}–${kmEnd.toFixed(1)} (anchor @ km ${nearest.alongKm.toFixed(1)})`
      );
    }
  }
  return { km_start: kmStart, km_end: kmEnd };
}

/** Aggiorna solo resupply ufficiali, ponti e sezioni tough — non tocca traccia né POI OSM. */
export function reseedCourseMarkers(
  db: SqliteDatabase,
  trackId: string,
  simplified: Position[],
  cum: number[],
  totalKm: number,
  log: (msg: string) => void = () => {}
): ReseedCourseMarkersResult {
  db.prepare(`DELETE FROM official_resupply WHERE track_id = ?`).run(trackId);
  const insRs = db.prepare(
    `INSERT INTO official_resupply (id, track_id, name, along_km, leg_km, lat, lng, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of STATIC_RESUPPLY) {
    let alongKm = r.along_km;
    let lat: number;
    let lng: number;
    if (r.lat != null && r.lng != null) {
      const nearest = nearestPointOnPolyline(simplified, [r.lng, r.lat], cum);
      if (nearest) {
        alongKm = nearest.alongKm;
        lng = nearest.closest[0];
        lat = nearest.closest[1];
      } else {
        const pos = positionAtKm(simplified, cum, r.along_km);
        lat = pos[1];
        lng = pos[0];
      }
    } else {
      const pos = positionAtKm(simplified, cum, r.along_km);
      lat = pos[1];
      lng = pos[0];
    }
    insRs.run(
      r.id,
      trackId,
      r.name,
      Number(alongKm.toFixed(3)),
      r.leg_km,
      Number(lat.toFixed(6)),
      Number(lng.toFixed(6)),
      r.notes
    );
  }

  db.prepare(`DELETE FROM course_bridges WHERE track_id = ?`).run(trackId);
  const insBr = db.prepare(
    `INSERT INTO course_bridges (id, track_id, name, lat, lng, along_km, description_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const b of STATIC_BRIDGES) {
    const nearest = nearestPointOnPolyline(simplified, [b.lng, b.lat], cum);
    const lat = nearest ? nearest.closest[1] : b.lat;
    const lng = nearest ? nearest.closest[0] : b.lng;
    const alongKm = nearest?.alongKm ?? 0;
    insBr.run(
      b.id,
      trackId,
      b.name,
      Number(lat.toFixed(6)),
      Number(lng.toFixed(6)),
      Number(alongKm.toFixed(3)),
      b.description_en
    );
  }

  db.prepare(`DELETE FROM notable_sections WHERE track_id = ?`).run(trackId);
  const insSec = db.prepare(
    `INSERT INTO notable_sections (id, track_id, label, km_start, km_end, severity, description, description_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const s of STATIC_SECTIONS) {
    const { km_start, km_end } = resolveSectionKm(s, simplified, cum, totalKm, log);
    insSec.run(
      s.id,
      trackId,
      s.label,
      Number(km_start.toFixed(3)),
      Number(km_end.toFixed(3)),
      s.severity,
      s.description,
      s.description_en
    );
  }

  return {
    resupply: STATIC_RESUPPLY.length,
    bridges: STATIC_BRIDGES.length,
    sections: STATIC_SECTIONS.length,
  };
}
