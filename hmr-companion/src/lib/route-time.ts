import type { UserRouteActivity } from "@/lib/sports";

type TimeModel =
  /** DIN 33466: max(orizz., vert.) + min/2 — standard CAI/DAV per sentieri. */
  | { kind: "din"; flatKmh: number; upMh: number; downMh: number }
  /** Ciclismo: tempo in piano + penalità salita (discesa ≈ recupero). */
  | { kind: "bike"; flatKmh: number; upMh: number };

const MODELS: Record<UserRouteActivity, TimeModel> = {
  hike: { kind: "din", flatKmh: 4, upMh: 300, downMh: 500 },
  trail_run: { kind: "din", flatKmh: 8.5, upMh: 650, downMh: 1100 },
  snowshoe: { kind: "din", flatKmh: 3.5, upMh: 280, downMh: 450 },
  ferrata: { kind: "din", flatKmh: 2.5, upMh: 250, downMh: 350 },
  ski: { kind: "din", flatKmh: 4.5, upMh: 350, downMh: 1800 },
  nordic: { kind: "bike", flatKmh: 11, upMh: 500 },
  road: { kind: "bike", flatKmh: 25, upMh: 750 },
  gravel: { kind: "bike", flatKmh: 18, upMh: 600 },
  mtb: { kind: "bike", flatKmh: 13, upMh: 480 },
  walk: { kind: "din", flatKmh: 4.5, upMh: 320, downMh: 550 },
  run: { kind: "din", flatKmh: 10, upMh: 700, downMh: 1200 },
  alpinism: { kind: "din", flatKmh: 3, upMh: 250, downMh: 380 },
  ebike: { kind: "bike", flatKmh: 21, upMh: 1300 },
  bikepacking: { kind: "bike", flatKmh: 15, upMh: 500 },
};

/** Tempo di percorrenza stimato in minuti (in movimento, senza soste). */
export function estimateDurationMin(
  activity: UserRouteActivity,
  km: number,
  gainM: number,
  lossM: number,
): number {
  if (!(km > 0)) return 0;
  const m = MODELS[activity];
  const g = Math.max(0, gainM);
  const l = Math.max(0, lossM);
  if (m.kind === "bike") {
    return Math.round((km / m.flatKmh + g / m.upMh) * 60);
  }
  const horiz = km / m.flatKmh;
  const vert = g / m.upMh + l / m.downMh;
  const h = Math.max(horiz, vert) + Math.min(horiz, vert) / 2;
  return Math.round(h * 60);
}

/** "3 h 25" · "45 min" */
export function formatDuration(min: number): string {
  if (!(min > 0)) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}
