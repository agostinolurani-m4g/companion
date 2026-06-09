export type RecordedPoint = {
  lat: number;
  lng: number;
  eleM?: number | null;
  ts: number;
  accuracyM?: number;
};

export const MAX_ACCURACY_M = 50;
export const MIN_DISTANCE_M = 3;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function filterRecordedPoint(
  point: RecordedPoint,
  lastAccepted: RecordedPoint | null
): boolean {
  if (point.accuracyM != null && point.accuracyM > MAX_ACCURACY_M) return false;
  if (!lastAccepted) return true;
  const d = haversineM(lastAccepted.lat, lastAccepted.lng, point.lat, point.lng);
  return d >= MIN_DISTANCE_M;
}
