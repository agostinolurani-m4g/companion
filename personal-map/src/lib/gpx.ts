import type { Feature, LineString, Position } from "geojson";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function geojsonLineToGpx(name: string, feature: Feature<LineString>): string {
  const coords = feature.geometry.coordinates as Position[];
  const pts = coords
    .map((c) => {
      const [lng, lat, ele] = c;
      const z = ele != null ? `<ele>${ele}</ele>` : "";
      return `      <trkpt lat="${lat}" lon="${lng}">${z}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="HMR Companion" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name></metadata>
  <trk><name>${escapeXml(name)}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
}

export type ParsedTrkpt = {
  lat: number;
  lng: number;
  eleM?: number;
  timeIso?: string;
};

/**
 * Parse di tutti i trkpt uniti in un'unica polilinea. HMR Companion lavora su
 * un singolo file "master": se il GPX ha più `<trkseg>`, li concateniamo in
 * ordine di apparizione preservando l'eventuale `<ele>`.
 */
export function parseGpxTrackpoints(xml: string): ParsedTrkpt[] {
  const pts: ParsedTrkpt[] = [];
  const segMatcher = /<trkseg[^>]*>([\s\S]*?)<\/trkseg>/gi;
  let segMatch: RegExpExecArray | null;
  while ((segMatch = segMatcher.exec(xml)) !== null) {
    const segment = segMatch[1];
    const block = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
    let m: RegExpExecArray | null;
    while ((m = block.exec(segment)) !== null) {
      const attrs = m[1];
      const inner = m[2];
      const latM = /lat="([^"]+)"/i.exec(attrs);
      const lonM = /lon="([^"]+)"/i.exec(attrs);
      if (!latM || !lonM) continue;
      const lat = parseFloat(latM[1]);
      const lng = parseFloat(lonM[1]);
      const eleM = /<ele>([^<]+)<\/ele>/i.exec(inner);
      const timeM = /<time>([^<]+)<\/time>/i.exec(inner);
      pts.push({
        lat,
        lng,
        eleM: eleM ? parseFloat(eleM[1].trim()) : undefined,
        timeIso: timeM ? timeM[1].trim() : undefined,
      });
    }
  }
  return pts;
}

export function recordedPointsToGpx(
  name: string,
  points: Array<{ lat: number; lng: number; eleM?: number | null; ts: number }>
): string {
  const pts = points
    .map((p) => {
      const z =
        p.eleM != null && Number.isFinite(p.eleM) ? `<ele>${p.eleM}</ele>` : "";
      const t = `<time>${new Date(p.ts).toISOString()}</time>`;
      return `      <trkpt lat="${p.lat}" lon="${p.lng}">${z}${t}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Personal Map" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name></metadata>
  <trk><name>${escapeXml(name)}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
}

export function parseGpxToLineString(xml: string): Feature<LineString> | null {
  const pts = parseGpxTrackpoints(xml);
  if (pts.length < 2) return null;
  const coordinates: Position[] = pts.map((p) => {
    const c: Position = [p.lng, p.lat];
    if (p.eleM != null) c.push(p.eleM);
    return c;
  });
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  };
}
