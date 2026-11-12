import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchOrsRouteLine, pickRoadLeg, sliceOrsExtras, splitOrsIntoLegs, type OrsLeg } from "@/lib/openrouteservice-route";

describe("ORS per tratti", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ritaglia gli extra e li reindicizza", () => {
    const extras = { surface: { values: [[0, 3, 1], [3, 8, 2]] as [number, number, number][] } };
    expect(sliceOrsExtras(extras, 2, 6)).toEqual({ surface: { values: [[0, 1, 1], [1, 4, 2]] } });
  });

  it("divide il percorso con way_points", () => {
    const coords: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    const legs = splitOrsIntoLegs({ coords, wayPoints: [0, 2, 4] }, 3)!;
    expect(legs.map((l) => l.coords)).toEqual([
      [[0, 0], [1, 0], [2, 0]],
      [[2, 0], [3, 0], [4, 0]],
    ]);
  });

  it("riusa i tratti in cache e chiede a ORS solo quelli cambiati, con le tappe agganciate", async () => {
    const store = new Map<string, OrsLeg>();
    const cache = { get: (k: string) => store.get(k) ?? null, set: (k: string, l: OrsLeg) => void store.set(k, l) };
    const calls: number[][][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { coordinates: number[][] };
        calls.push(body.coordinates);
        // Finto ORS: linea che passa per le tappe spostate di 0.001 in lat (= "agganciate").
        const pts = body.coordinates.map(([x, y]) => [x, y + 0.001]);
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: { way_points: pts.map((_, i) => i) }, geometry: { type: "LineString", coordinates: pts } }],
          }),
          { status: 200 },
        );
      }),
    );
    const wps: [number, number][] = [[9, 46], [9.01, 46], [9.02, 46], [9.03, 46]];
    const first = await fetchOrsRouteLine(wps, "hike", "k", "recommended", cache);
    expect(calls).toHaveLength(1);
    expect(first!.snapped[1]).toEqual([9.01, 46.001]);

    // Sposto la tappa 3: si ricalcolano solo i tratti 2→3 e 3→4, in una richiesta.
    calls.length = 0;
    const moved: [number, number][] = [[9, 46], [9.01, 46], [9.025, 46.01], [9.03, 46]];
    const second = await fetchOrsRouteLine(moved, "hike", "k", "recommended", cache);
    expect(calls).toEqual([[[9.01, 46], [9.025, 46.01], [9.03, 46]]]);
    expect(second!.feature.geometry.coordinates).toHaveLength(4);
  });
});

describe("bici da strada: preferisci ciclabili", () => {
  afterEach(() => vi.unstubAllGlobals());

  // ORS: surface 1 = asfalto, 2 = sterrato; waytype 3 = strada, 6 = ciclabile.
  const line = (n: number, dLat = 0): [number, number][] =>
    Array.from({ length: n }, (_, i) => [9 + i * 0.001, 45.4 + dLat] as [number, number]);
  const leg = (coords: [number, number][], surface: number, waytype: number): OrsLeg => ({
    coords,
    extras: { surface: { values: [[0, coords.length - 1, surface]] }, waytype: { values: [[0, coords.length - 1, waytype]] } },
  });

  it("sceglie la ciclabile asfaltata", () => {
    const road = leg(line(10), 1, 3);
    const cycle = leg(line(11, 0.0001), 1, 6);
    expect(pickRoadLeg(road, cycle)).toBe(cycle);
  });

  it("scarta la ciclabile sterrata", () => {
    const road = leg(line(10), 1, 3);
    expect(pickRoadLeg(road, leg(line(10, 0.0001), 2, 6))).toBe(road);
  });

  it("scarta la ciclabile che allunga più del 25%", () => {
    const road = leg(line(10), 1, 3);
    expect(pickRoadLeg(road, leg(line(14, 0.0001), 1, 6))).toBe(road);
  });

  it("con l'interruttore acceso chiede entrambi i profili, spento solo cycling-road", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        urls.push(url);
        const body = JSON.parse(init.body) as { coordinates: number[][] };
        const regular = url.includes("cycling-regular");
        const coords = regular ? line(11, 0.0001) : line(10);
        coords[0] = body.coordinates[0] as [number, number];
        coords[coords.length - 1] = body.coordinates[1] as [number, number];
        const n = coords.length - 1;
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [{
              type: "Feature",
              properties: { extras: { surface: { values: [[0, n, 1]] }, waytype: { values: [[0, n, regular ? 6 : 3]] } } },
              geometry: { type: "LineString", coordinates: coords },
            }],
          }),
          { status: 200 },
        );
      }),
    );
    const wps: [number, number][] = [[9, 45.4], [9.009, 45.4]];
    const on = await fetchOrsRouteLine(wps, "road", "k", "recommended", undefined, { preferCycleways: true });
    expect(urls.some((u) => u.includes("cycling-regular"))).toBe(true);
    expect(urls.some((u) => u.includes("cycling-road"))).toBe(true);
    expect(on!.feature.geometry.coordinates).toHaveLength(11);

    urls.length = 0;
    const off = await fetchOrsRouteLine(wps, "road", "k", "recommended");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("cycling-road");
    expect(off!.feature.geometry.coordinates).toHaveLength(10);
  });
});
