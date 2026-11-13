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
