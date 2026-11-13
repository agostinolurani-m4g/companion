import { describe, expect, it } from "vitest";
import {
  hoursInDay,
  mergeModelSpread,
  modelAgreement,
  modelSpreadUrl,
  nightHours,
  parsePrecisionHourly,
  precisionUrl,
  PRECISION_MODELS,
  summarizeNight,
  summarizeWindow,
} from "@/lib/precision-weather";
import { legSnapOffsetM, pickCloserSnapLeg, type OrsLeg } from "@/lib/openrouteservice-route";

const TIMES = ["2026-11-14T12:00", "2026-11-14T22:00", "2026-11-15T04:00", "2026-11-15T12:00"];

function mainJson() {
  return {
    elevation: 2800,
    hourly: {
      time: TIMES,
      temperature_2m: [-2, -6, -9, null],
      relative_humidity_2m: [60, 85, 92, 50],
      dew_point_2m: [-8.7, -8.1, -10, -9],
      apparent_temperature: [-7, -12, -16, -5],
      precipitation: [0, 0.4, 0, 0],
      precipitation_probability: [10, 60, 20, 0],
      cloud_cover: [20, 90, 40, 0],
      wind_speed_10m: [20, 30, 25, 10],
      wind_direction_10m: [300, 310, 320, 300],
      wind_gusts_10m: [40, 55, 50, 20],
      freezing_level_height: [2300, 1900, 1700, 2500],
      uv_index: [3, 0, 0, 3],
      snowfall: [0, 0.5, 0, 0],
      weather_code: [1, 71, 2, 0],
    },
  };
}

function spreadJson() {
  const [a, b] = PRECISION_MODELS;
  return {
    hourly: {
      time: TIMES,
      [`temperature_2m_${a.id}`]: [-1, -5, -8, 1],
      [`relative_humidity_2m_${a.id}`]: [55, 80, 90, 45],
      [`temperature_2m_${b.id}`]: [-4, -8, null, 2],
      [`relative_humidity_2m_${b.id}`]: [70, 95, null, 50],
    },
  };
}

describe("URL Open-Meteo", () => {
  it("previsione alla quota del punto, nei giorni richiesti", () => {
    const u = new URL(precisionUrl(46.42, 9.35, 2803.4, "2026-11-14", "2026-11-16"));
    expect(u.searchParams.get("elevation")).toBe("2803");
    expect(u.searchParams.get("start_date")).toBe("2026-11-14");
    expect(u.searchParams.get("end_date")).toBe("2026-11-16");
    expect(u.searchParams.get("hourly")).toContain("relative_humidity_2m");
    expect(u.searchParams.has("models")).toBe(false);
  });

  it("confronto modelli: solo temperatura e umidità, quota dal DEM se ignota", () => {
    const u = new URL(modelSpreadUrl(46.42, 9.35, null, "2026-11-14", "2026-11-14"));
    expect(u.searchParams.get("hourly")).toBe("temperature_2m,relative_humidity_2m");
    expect(u.searchParams.get("models")?.split(",")).toHaveLength(PRECISION_MODELS.length);
    expect(u.searchParams.has("elevation")).toBe(false);
  });
});

describe("parsing", () => {
  it("scarta le ore senza temperatura e legge l'umidità", () => {
    const { hourly, elevation } = parsePrecisionHourly(mainJson());
    expect(elevation).toBe(2800);
    expect(hourly).toHaveLength(3);
    expect(hourly[1]).toMatchObject({ temperature_c: -6, humidity_pct: 85, gust_kmh: 55, snowfall_cm: 0.5, models_n: 0 });
  });

  it("min/max tra modelli, ignorando quelli senza dati", () => {
    const { hourly, models } = mergeModelSpread(parsePrecisionHourly(mainJson()).hourly, spreadJson());
    expect(hourly[0]).toMatchObject({ t_min_c: -4, t_max_c: -1, rh_min_pct: 55, rh_max_pct: 70, models_n: 2 });
    expect(hourly[2]).toMatchObject({ t_min_c: -8, t_max_c: -8, models_n: 1 });
    expect(models.map((m) => m.id)).toEqual([PRECISION_MODELS[0].id, PRECISION_MODELS[1].id]);
    expect(models[1].hours).toBe(2);
  });

  it("JSON vuoto: nessuna ora, nessun errore", () => {
    expect(parsePrecisionHourly({}).hourly).toEqual([]);
    expect(mergeModelSpread([], {}).models).toEqual([]);
  });
});

describe("riassunti", () => {
  const hours = mergeModelSpread(parsePrecisionHourly(mainJson()).hourly, spreadJson()).hourly;

  it("finestre di giorno e di notte", () => {
    expect(hoursInDay(hours, "2026-11-14", 6, 20).map((h) => h.time)).toEqual(["2026-11-14T12:00"]);
    expect(nightHours(hours, "2026-11-14", "2026-11-15").map((h) => h.time)).toEqual(["2026-11-14T22:00", "2026-11-15T04:00"]);
  });

  it("giorno: temperatura, umidità, estremi tra modelli e accordo", () => {
    const w = summarizeWindow(hoursInDay(hours, "2026-11-14", 6, 20));
    expect(w).toMatchObject({
      temp_min_c: -2,
      temp_max_c: -2,
      humidity_min_pct: 60,
      t_low_c: -4,
      t_high_c: -1,
      spread_t_c: 3,
      spread_rh_pct: 15,
      gust_max_kmh: 40,
      freezing_level_min_m: 2300,
    });
    expect(w!.wind_chill_min_c).toBeLessThan(-8);
    expect(summarizeWindow([])).toBeNull();
  });

  it("notte: minima più bassa tra i modelli e sacco consigliato", () => {
    const n = summarizeNight(hours, "2026-11-14", "2026-11-15", true);
    expect(n).not.toBeNull();
    expect(n!.t_low_c).toBe(-9);
    expect(n!.bag_comfort_c).toBe(-15);
    expect(n!.humidity_max_pct).toBe(92);
    expect(n!.snowfall_cm).toBe(0.5);
    expect(summarizeNight(hours, "2026-12-01", "2026-12-02", false)).toBeNull();
  });

  it("accordo tra modelli", () => {
    expect(modelAgreement(null)).toBeNull();
    expect(modelAgreement(1.5)).toBe("high");
    expect(modelAgreement(3)).toBe("medium");
    expect(modelAgreement(6)).toBe("low");
  });
});

describe("aggancio della tappa (ciclabile vs strada)", () => {
  // Tappe messe sulla ciclabile; la strada corre ~35 m più a nord.
  const a: [number, number] = [9.0, 45.0];
  const b: [number, number] = [9.01, 45.0];
  const cycleway: OrsLeg = { coords: [[9.0, 45.00001], [9.01, 45.00001]] };
  const road: OrsLeg = { coords: [[9.0, 45.00032], [9.01, 45.00032]] };

  it("misura la distanza tra tappe richieste ed estremi del tratto", () => {
    expect(legSnapOffsetM(cycleway, a, b)).toBeLessThan(5);
    expect(legSnapOffsetM(road, a, b)).toBeGreaterThan(60);
  });

  it("preferisce il tratto che passa dove l'utente ha messo le tappe", () => {
    expect(pickCloserSnapLeg(road, cycleway, a, b)).toBe(cycleway);
  });

  it("tiene il tratto principale se è già vicino o se l'alternativa non migliora", () => {
    expect(pickCloserSnapLeg(cycleway, road, a, b)).toBe(cycleway);
    expect(pickCloserSnapLeg(road, null, a, b)).toBe(road);
    expect(pickCloserSnapLeg(road, { coords: [[9.0, 45.0003], [9.01, 45.0003]] }, a, b)).toBe(road);
  });
});
