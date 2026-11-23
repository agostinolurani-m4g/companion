/**
 * Alba e tramonto (equazione dell'alba, precisione di 1–2 minuti alle medie latitudini).
 * Non tiene conto dell'orizzonte reale: in valle il sole arriva dopo e se ne va prima.
 */

const RAD = Math.PI / 180;
/** Giorno giuliano dell'epoca Unix. */
const JD_UNIX_EPOCH = 2440587.5;
const JD_J2000 = 2451545.0;

export type SunTimes = {
  /** ISO UTC; null con sole di mezzanotte o notte polare. */
  sunrise: string | null;
  sunset: string | null;
  daylight_hours: number;
};

/** Alba e tramonto del giorno `date` (`YYYY-MM-DD`, data locale del luogo). */
export function sunTimes(lat: number, lng: number, date: string): SunTimes {
  const noonUtc = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(noonUtc)) return { sunrise: null, sunset: null, daylight_hours: 0 };
  // Numero del giorno da J2000, riferito al mezzogiorno locale medio del luogo.
  const n = Math.round(noonUtc / 86_400_000 + JD_UNIX_EPOCH - JD_J2000);
  const jStar = n - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = JD_J2000 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDecl = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDecl = Math.cos(Math.asin(sinDecl));
  const cosOmega = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDecl) / (Math.cos(lat * RAD) * cosDecl);
  if (cosOmega >= 1) return { sunrise: null, sunset: null, daylight_hours: 0 };
  if (cosOmega <= -1) return { sunrise: null, sunset: null, daylight_hours: 24 };
  const omega = Math.acos(cosOmega) / RAD;
  const toIso = (jd: number) => new Date((jd - JD_UNIX_EPOCH) * 86_400_000).toISOString();
  return {
    sunrise: toIso(jTransit - omega / 360),
    sunset: toIso(jTransit + omega / 360),
    daylight_hours: Math.round(((2 * omega) / 15) * 10) / 10,
  };
}

const J1970 = 2440588;
const DAY_MS = 86_400_000;
const OBLIQUITY = 23.4397 * RAD;

/** Posizione del sole: azimut da nord in senso orario e altezza sull'orizzonte astronomico (gradi). */
export function sunPosition(time: Date | number, lat: number, lng: number): { azimuth: number; elevation: number } {
  const d = (typeof time === "number" ? time : time.getTime()) / DAY_MS - 0.5 + J1970 - JD_J2000;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const phi = RAD * lat;
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lng - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth: ((azSouth / RAD + 180) % 360 + 360) % 360, elevation: alt / RAD };
}

export type SunPathPoint = { time: number; azimuth: number; elevation: number };

/** Percorso del sole nel giorno (00:00–24:00 del fuso del browser per `day`), ogni `stepMin` minuti. */
export function sunPath(day: Date, lat: number, lng: number, stepMin = 10): SunPathPoint[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const out: SunPathPoint[] = [];
  for (let m = 0; m <= 24 * 60; m += stepMin) {
    const time = start.getTime() + m * 60_000;
    out.push({ time, ...sunPosition(time, lat, lng) });
  }
  return out;
}

/**
 * Alba e tramonto "veri" dietro le montagne: il primo e l'ultimo istante in cui
 * il sole sta sopra la linea dell'orizzonte reale (`horizonAt(azimut)` in gradi).
 */
export function terrainSunTimes(
  path: SunPathPoint[],
  horizonAt: (azimuth: number) => number,
): { sunrise: number | null; sunset: number | null; hours: number } {
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let up = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const visible = p.elevation > horizonAt(p.azimuth);
    if (visible) {
      if (sunrise == null) sunrise = p.time;
      sunset = p.time;
      if (i > 0) up += p.time - path[i - 1].time;
    }
  }
  return { sunrise, sunset, hours: Math.round((up / 3_600_000) * 10) / 10 };
}
