/**
 * Parsing GPX minimale (trk/trkseg/trkpt) senza dipendenze esterne.
 */

export type GpxParseResult = {
  name: string | null;
  coordinates: [number, number][];
  length_km: number;
};

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lineLengthKm(coords: [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += haversineKm(coords[i - 1], coords[i]);
  return sum;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseGpx(xml: string): GpxParseResult {
  const nameMatch = xml.match(/<name[^>]*>([^<]+)<\/name>/i);
  const name = nameMatch ? decodeXmlEntities(nameMatch[1].trim()) : null;

  const coords: [number, number][] = [];
  const trkptRe = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = trkptRe.exec(xml)) !== null) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push([lng, lat]);
  }

  if (coords.length < 2) {
    const rteptRe = /<rtept[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*\/?>/gi;
    while ((m = rteptRe.exec(xml)) !== null) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push([lng, lat]);
    }
  }

  return {
    name,
    coordinates: coords,
    length_km: lineLengthKm(coords),
  };
}

export async function parseGpxFile(file: File): Promise<GpxParseResult> {
  const text = await file.text();
  return parseGpx(text);
}
