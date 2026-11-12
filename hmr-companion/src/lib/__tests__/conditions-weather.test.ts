import { describe, expect, it } from "vitest";
import {
  dailyFromHourly,
  emmaForEawsRegion,
  openMeteoUrl,
  parseMeteoAlarmWarnings,
  parseOpenMeteo,
  pointCacheKey,
  startAndSummit,
  winterWidgetsFor,
} from "@/lib/conditions";

const NOW = Date.parse("2026-11-11T10:00:00Z");

function warning(opts: {
  id: string;
  emma: string;
  area: string;
  level: string;
  type: string;
  expires: string;
  msgType?: string;
  references?: string;
}) {
  return {
    alert: {
      identifier: opts.id,
      msgType: opts.msgType ?? "Alert",
      status: "Actual",
      sent: "2026-11-10T11:11:32+01:00",
      references: opts.references,
      info: [
        {
          language: "en-GB",
          area: [{ areaDesc: opts.area, geocode: [{ valueName: "EMMA_ID", value: opts.emma }] }],
          description: "english",
          onset: "2026-11-12T07:00:00+01:00",
          expires: opts.expires,
          parameter: [
            { valueName: "awareness_level", value: opts.level },
            { valueName: "awareness_type", value: opts.type },
          ],
        },
        {
          language: "it-IT",
          area: [{ areaDesc: opts.area, geocode: [{ valueName: "EMMA_ID", value: opts.emma }] }],
          description: 'Sono previsti fenomeni intensi SETTORE EST\n (DISCLAIMER: "Le informazioni...")',
          onset: "2026-11-12T07:00:00+01:00",
          expires: opts.expires,
          parameter: [
            { valueName: "awareness_level", value: opts.level },
            { valueName: "awareness_type", value: opts.type },
          ],
          web: "https://meteoalarm.org/it/live/region/IT?s=lombardia",
        },
      ],
    },
  };
}

describe("parseMeteoAlarmWarnings", () => {
  const feed = {
    warnings: [
      warning({ id: "a1", emma: "IT003", area: "Lombardia", level: "3; orange; Severe", type: "3; Thunderstorm", expires: "2026-11-12T23:59:00+01:00" }),
      // verde: ignorata
      warning({ id: "a2", emma: "IT003", area: "Lombardia", level: "1; green; Minor", type: "10; Rain", expires: "2026-11-12T23:59:00+01:00" }),
      // scaduta: ignorata
      warning({ id: "a3", emma: "IT003", area: "Lombardia", level: "2; yellow; Moderate", type: "4; Fog", expires: "2026-11-08T07:59:00+01:00" }),
      // sostituita da a5
      warning({ id: "a4", emma: "IT003", area: "Lombardia", level: "2; yellow; Moderate", type: "10; Rain", expires: "2026-11-12T23:59:00+01:00" }),
      warning({
        id: "a5",
        emma: "IT003",
        area: "Lombardia",
        level: "3; orange; Severe",
        type: "10; Rain",
        expires: "2026-11-12T23:59:00+01:00",
        msgType: "Update",
        references: "sender@example,a4,2026-11-09T10:00:00+01:00",
      }),
      warning({ id: "b1", emma: "IT019", area: "Sardegna", level: "3; orange; Severe", type: "1; Wind", expires: "2026-11-12T23:59:00+01:00" }),
    ],
  };

  it("tiene solo allerte attive ≥ gialle, non sostituite, in italiano", () => {
    const list = parseMeteoAlarmWarnings(feed, NOW);
    const lombardia = list.filter((a) => a.emma === "IT003");
    expect(lombardia.map((a) => a.title).sort()).toEqual(["Allerta arancione · Pioggia", "Allerta arancione · Temporali"]);
    expect(lombardia[0].description).toBe("Sono previsti fenomeni intensi SETTORE EST");
    expect(lombardia[0].area).toBe("Lombardia");
  });

  it("le allerte di un'altra regione non finiscono nel punto", () => {
    const list = parseMeteoAlarmWarnings(feed, NOW).filter((a) => a.emma === "IT003");
    expect(list.some((a) => a.area === "Sardegna")).toBe(false);
  });

  it("feed vuoto o malformato", () => {
    expect(parseMeteoAlarmWarnings(null, NOW)).toEqual([]);
    expect(parseMeteoAlarmWarnings({ warnings: [{}] }, NOW)).toEqual([]);
  });
});

describe("mappa regione EAWS → area MeteoAlarm", () => {
  it("regioni verificate", () => {
    expect(emmaForEawsRegion("IT-25-SO-01")?.emma).toBe("IT003");
    expect(emmaForEawsRegion("IT-21-VB-02")?.emma).toBe("IT005");
    expect(emmaForEawsRegion("IT-32-BZ-05-01")?.emma).toBe("IT002");
  });
  it("Valle d'Aosta, Svizzera, Francia e fuori copertura: nessuna allerta", () => {
    expect(emmaForEawsRegion("IT-23-AO-01")).toBeNull();
    expect(emmaForEawsRegion("CH-4241")).toBeNull();
    expect(emmaForEawsRegion("FR-01")).toBeNull();
    expect(emmaForEawsRegion(null)).toBeNull();
  });
});

describe("Open-Meteo", () => {
  it("URL con 3 giorni, quota e variabili invernali solo se richieste", () => {
    const w = new URL(openMeteoUrl(46.4, 9.6, 2987.4, true));
    expect(w.searchParams.get("forecast_days")).toBe("3");
    expect(w.searchParams.get("elevation")).toBe("2987");
    expect(w.searchParams.get("hourly")).toContain("freezing_level_height");
    expect(w.searchParams.get("hourly")).toContain("wind_speed_700hPa");
    const s = new URL(openMeteoUrl(46.4, 9.6, null, false));
    expect(s.searchParams.has("elevation")).toBe(false);
    expect(s.searchParams.get("hourly")).not.toContain("snowfall");
  });

  it("parsa ore e riassume per giorno (neve in cm, altezza neve da m a cm)", () => {
    const j = {
      elevation: 3000,
      hourly: {
        time: ["2026-11-11T10:00", "2026-11-11T11:00", "2026-11-12T10:00"],
        temperature_2m: [-2.1, -1, -5],
        precipitation: [0, 0.4, 1.2],
        wind_gusts_10m: [34.9, 40.3, 20],
        wind_speed_10m: [15, 19, 10],
        cape: [0, 0, 0],
        lightning_potential: [0, 0, null],
        weather_code: [3, 71, 73],
        freezing_level_height: [2710, 2700, 1500],
        snowfall: [0, 0.3, 1.4],
        snow_depth: [0.07, 0.07, 0.1],
        wind_speed_700hPa: [21, 29, 50],
        wind_direction_700hPa: [230, 220, 300],
      },
    };
    const { hourly, elevation } = parseOpenMeteo(j, true);
    expect(elevation).toBe(3000);
    expect(hourly[0].snow_depth_cm).toBe(7);
    expect(hourly[2].lightning_index).toBe(0);
    const days = dailyFromHourly(hourly);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({
      date: "2026-11-11",
      temp_min_c: -2.1,
      temp_max_c: -1,
      precipitation_mm: 0.4,
      gust_max_kmh: 40.3,
      snowfall_cm: 0.3,
      freezing_level_min_m: 2700,
      freezing_level_max_m: 2710,
      wind_700hpa_max_kmh: 29,
    });
    const summer = dailyFromHourly(parseOpenMeteo(j, false).hourly);
    expect(summer[0].snowfall_cm).toBeNull();
    expect(summer[0].freezing_level_min_m).toBeNull();
  });

  it("chiave di cache distingue quota e sport invernale", () => {
    expect(pointCacheKey(46.4, 9.6, null, false)).not.toBe(pointCacheKey(46.4, 9.6, 2900, false));
    expect(pointCacheKey(46.4, 9.6, 2900, true)).not.toBe(pointCacheKey(46.4, 9.6, 2900, false));
    expect(pointCacheKey(46.4, 9.6, 2910, true)).toBe(pointCacheKey(46.4, 9.6, 2905, true));
  });

  it("widget invernali guidati da conditionWidgets", () => {
    expect(winterWidgetsFor("ski")).toBe(true);
    expect(winterWidgetsFor("snowshoe")).toBe(true);
    expect(winterWidgetsFor("nordic")).toBe(true);
    expect(winterWidgetsFor("hike")).toBe(false);
    expect(winterWidgetsFor(null)).toBe(false);
    expect(winterWidgetsFor("boh")).toBe(false);
  });
});

describe("startAndSummit", () => {
  it("partenza = primo punto, vetta = quota massima", () => {
    const r = startAndSummit([
      [9.5, 46.3, 1500],
      [9.6, 46.4, 2900],
      [9.7, 46.5, 2100],
    ]);
    expect(r?.start).toEqual({ lng: 9.5, lat: 46.3, ele: 1500 });
    expect(r?.summit).toEqual({ lng: 9.6, lat: 46.4, ele: 2900 });
  });
  it("senza quote nessuna vetta", () => {
    expect(startAndSummit([[9.5, 46.3], [9.6, 46.4]])?.summit).toBeNull();
    expect(startAndSummit([])).toBeNull();
  });
});
