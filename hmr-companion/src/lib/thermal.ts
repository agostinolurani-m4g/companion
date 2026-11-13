/**
 * Stress termico per outdoor estremo: grandezze fisiche derivate da temperatura,
 * umidità e vento, e pericoli che ne conseguono (congelamento, freddo umido,
 * colpo di calore, visibilità, rigelo). Funzioni pure, senza I/O.
 */

export type ThermalInput = {
  temperature_c: number;
  /** Umidità relativa 0–100. */
  humidity_pct: number | null;
  /** Vento medio a 10 m. */
  wind_kmh: number | null;
  /** Raffica: usata per il caso peggiore del wind chill. */
  gust_kmh?: number | null;
  precipitation_mm?: number | null;
};

/** Punto di rugiada (Magnus, coefficienti Alduchov–Eskridge). */
export function dewPointC(tempC: number, rhPct: number): number {
  const rh = Math.min(100, Math.max(1, rhPct));
  const g = Math.log(rh / 100) + (17.625 * tempC) / (243.04 + tempC);
  return (243.04 * g) / (17.625 - g);
}

/**
 * Temperatura di bulbo umido (Stull 2011). Errore < 1 °C per RH 5–99 % e
 * T −20…50 °C a pressione di livello del mare; in quota sottostima di poco.
 */
export function wetBulbC(tempC: number, rhPct: number): number {
  const rh = Math.min(99, Math.max(5, rhPct));
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  );
}

/**
 * Wind chill (indice JAG/TI, NWS–Environment Canada). Definito per T ≤ 10 °C e
 * vento ≥ 4,8 km/h: fuori da quel campo restituisce la temperatura dell'aria.
 */
export function windChillC(tempC: number, windKmh: number | null | undefined): number {
  if (windKmh == null || !Number.isFinite(windKmh) || tempC > 10 || windKmh < 4.8) return tempC;
  const v = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}

/**
 * WBGT all'ombra, stima semplificata (0,7·Tw + 0,3·T): al sole reale è più alto
 * di 2–4 °C. Serve a classificare lo sforzo al caldo umido.
 */
export function wbgtShadeC(tempC: number, rhPct: number): number {
  return 0.7 * wetBulbC(tempC, rhPct) + 0.3 * tempC;
}

/** Tempo indicativo al congelamento della pelle esposta (Environment Canada). */
export function frostbiteMinutes(windChill: number): { min: number; max: number } | null {
  if (windChill > -28) return null;
  if (windChill > -40) return { min: 10, max: 30 };
  if (windChill > -48) return { min: 5, max: 10 };
  if (windChill > -55) return { min: 2, max: 5 };
  return { min: 0, max: 2 };
}

export type HazardId = "frostbite" | "cold" | "wet_cold" | "heat" | "low_visibility" | "refreeze" | "dry_air";
/** 1 attenzione · 2 alto · 3 estremo */
export type HazardLevel = 1 | 2 | 3;

export type Hazard = { id: HazardId; level: HazardLevel; label: string; detail: string };

export type HourThermal = {
  dew_point_c: number | null;
  wet_bulb_c: number | null;
  wbgt_c: number | null;
  /** Wind chill con vento medio. */
  wind_chill_c: number;
  /** Wind chill con la raffica (caso peggiore). */
  wind_chill_gust_c: number;
  hazards: Hazard[];
};

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Grandezze derivate e pericoli di una singola ora. */
export function assessHour(h: ThermalInput): HourThermal {
  const t = h.temperature_c;
  const rh = h.humidity_pct != null && Number.isFinite(h.humidity_pct) ? h.humidity_pct : null;
  const wind = h.wind_kmh ?? null;
  const gust = h.gust_kmh ?? wind;
  const wc = windChillC(t, wind);
  const wcGust = windChillC(t, gust);
  const dew = rh == null ? null : dewPointC(t, rh);
  const wb = rh == null ? null : wetBulbC(t, rh);
  const wbgt = rh == null ? null : wbgtShadeC(t, rh);
  const rain = h.precipitation_mm ?? 0;
  const hazards: Hazard[] = [];

  const fb = frostbiteMinutes(wcGust);
  if (fb) {
    hazards.push({
      id: "frostbite",
      level: wcGust <= -40 ? 3 : 2,
      label: "Congelamento",
      detail: `Pelle esposta congela in ${fb.min === 0 ? `meno di ${fb.max}` : `${fb.min}–${fb.max}`} min (percepita ${Math.round(wcGust)} °C con le raffiche).`,
    });
  } else if (wcGust <= -15) {
    hazards.push({
      id: "cold",
      level: 1,
      label: "Freddo intenso",
      detail: `Percepita ${Math.round(wcGust)} °C con le raffiche: coprire viso e mani, soste brevi.`,
    });
  }

  // Freddo umido: bagnati + vento poco sopra lo zero è lo scenario classico da ipotermia.
  // Sotto zero la precipitazione è neve asciutta: lì contano wind chill e congelamento.
  if (t >= 0 && t <= 8 && rain >= 0.5 && (gust ?? 0) >= 20) {
    hazards.push({
      id: "wet_cold",
      level: rain >= 2 && (gust ?? 0) >= 40 ? 3 : 2,
      label: "Freddo umido",
      detail: `Pioggia a ${Math.round(t)} °C con vento a ${Math.round(gust ?? 0)} km/h: rischio ipotermia anche sopra zero.`,
    });
  }

  if (wbgt != null && wbgt >= 23) {
    hazards.push({
      id: "heat",
      level: wbgt >= 31 ? 3 : wbgt >= 28 ? 2 : 1,
      label: "Caldo umido",
      detail: `WBGT ${round1(wbgt)} °C all'ombra (bulbo umido ${round1(wb as number)} °C): ridurre il ritmo, bere di più.`,
    });
  }

  if (rh != null && dew != null && rh >= 97 && t - dew <= 0.6) {
    hazards.push({
      id: "low_visibility",
      level: 1,
      label: "Nubi basse / nebbia",
      detail: `Aria satura (umidità ${Math.round(rh)} %): probabile visibilità ridotta alla quota del punto.`,
    });
  }

  if (rh != null && rh <= 25 && t <= 5) {
    hazards.push({
      id: "dry_air",
      level: 1,
      label: "Aria molto secca",
      detail: `Umidità ${Math.round(rh)} %: disidratazione respiratoria elevata, bere anche senza sete.`,
    });
  }

  return {
    dew_point_c: dew == null ? null : round1(dew),
    wet_bulb_c: wb == null ? null : round1(wb),
    wbgt_c: wbgt == null ? null : round1(wbgt),
    wind_chill_c: round1(wc),
    wind_chill_gust_c: round1(wcGust),
    hazards,
  };
}

export type DayThermal = {
  temp_min_c: number | null;
  temp_max_c: number | null;
  humidity_min_pct: number | null;
  humidity_max_pct: number | null;
  dew_point_max_c: number | null;
  wet_bulb_max_c: number | null;
  wind_chill_min_c: number | null;
  /** Pericoli della giornata: il livello peggiore per tipo. */
  hazards: Hazard[];
};

type HourWithTime = ThermalInput & { time: string };

/**
 * Riassunto termico di un insieme di ore (una giornata o una notte).
 * Aggiunge il rigelo: pioggia o fusione di giorno seguite da gelo.
 */
export function summarizeThermal(hours: HourWithTime[]): DayThermal {
  let tMin: number | null = null;
  let tMax: number | null = null;
  let rhMin: number | null = null;
  let rhMax: number | null = null;
  let dewMax: number | null = null;
  let wbMax: number | null = null;
  let wcMin: number | null = null;
  const worst = new Map<HazardId, Hazard>();
  let wetAboveZero = false;
  let refreeze = false;

  for (const h of hours) {
    const a = assessHour(h);
    const t = h.temperature_c;
    if (tMin == null || t < tMin) tMin = t;
    if (tMax == null || t > tMax) tMax = t;
    if (h.humidity_pct != null) {
      if (rhMin == null || h.humidity_pct < rhMin) rhMin = h.humidity_pct;
      if (rhMax == null || h.humidity_pct > rhMax) rhMax = h.humidity_pct;
    }
    if (a.dew_point_c != null && (dewMax == null || a.dew_point_c > dewMax)) dewMax = a.dew_point_c;
    if (a.wet_bulb_c != null && (wbMax == null || a.wet_bulb_c > wbMax)) wbMax = a.wet_bulb_c;
    if (wcMin == null || a.wind_chill_gust_c < wcMin) wcMin = a.wind_chill_gust_c;
    for (const hz of a.hazards) {
      const cur = worst.get(hz.id);
      if (!cur || hz.level > cur.level) worst.set(hz.id, hz);
    }
    if (t > 0.5 && ((h.precipitation_mm ?? 0) >= 0.3 || t >= 4)) wetAboveZero = true;
    else if (wetAboveZero && t <= -1) refreeze = true;
  }

  if (refreeze) {
    worst.set("refreeze", {
      id: "refreeze",
      level: 1,
      label: "Rigelo",
      detail: "Fusione o pioggia seguite da gelo: ghiaccio vivo su sentieri, rocce e neve dura al mattino.",
    });
  }

  return {
    temp_min_c: tMin,
    temp_max_c: tMax,
    humidity_min_pct: rhMin,
    humidity_max_pct: rhMax,
    dew_point_max_c: dewMax,
    wet_bulb_max_c: wbMax,
    wind_chill_min_c: wcMin,
    hazards: [...worst.values()].sort((a, b) => b.level - a.level),
  };
}

/**
 * Temperatura comfort consigliata per il sacco a pelo: minima notturna meno un
 * margine (3 °C al riparo, 6 °C all'addiaccio esposto al vento).
 */
export function sleepingBagComfortC(nightMinC: number, exposed: boolean): number {
  return Math.floor(nightMinC - (exposed ? 6 : 3));
}

/**
 * Acqua da bere, litri per ora di movimento (stima da linee guida ACSM/UIAA:
 * 0,4–0,8 l/h secondo caldo, quota e aria secca). Non sostituisce la sete reale.
 */
export function waterLitersPerHour(tempC: number, rhPct: number | null, elevationM: number | null): number {
  let l = 0.4;
  if (tempC > 12) l += Math.min(0.4, ((tempC - 12) / 5) * 0.1);
  if (rhPct != null && tempC >= 20 && rhPct >= 70) l += 0.1;
  if (elevationM != null && elevationM >= 2500) l += 0.1;
  if (elevationM != null && elevationM >= 4000) l += 0.1;
  if (rhPct != null && rhPct <= 30) l += 0.05;
  return Math.round(l * 100) / 100;
}
