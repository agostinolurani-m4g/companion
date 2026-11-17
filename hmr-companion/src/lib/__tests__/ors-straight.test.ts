import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOrsRequestBody, fetchOrsRouteLine } from "@/lib/openrouteservice-route";

const A: [number, number] = [11, 45];
const B: [number, number] = [11.01, 45];
const C: [number, number] = [11.02, 45];

function okResponse(coords: [number, number][], wayPoints: number[]) {
  return {
    ok: true,
    json: async () => ({
      type: "FeatureCollection",
      features: [{ geometry: { type: "LineString", coordinates: coords }, properties: { way_points: wayPoints } }],
    }),
  };
}
const unroutable = { ok: false, json: async () => ({ error: { code: 2010, message: "Could not find routable point within a radius of 1000.0 meters" } }) };

afterEach(() => vi.unstubAllGlobals());

describe("buildOrsRequestBody", () => {
  it("evita i traghetti di default e li ammette su richiesta", () => {
    const avoid = (b: Record<string, unknown>) => (b.options as { avoid_features?: string[] } | undefined)?.avoid_features ?? [];
    expect(avoid(buildOrsRequestBody([A, B], "foot-hiking", "recommended", true))).toContain("ferries");
    expect(avoid(buildOrsRequestBody([A, B], "foot-hiking", "recommended", true, true))).not.toContain("ferries");
  });
});

describe("fetchOrsRouteLine: tratti non instradabili", () => {
  it("collega in linea retta il tratto impossibile e instrada gli altri", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const pts = JSON.parse(init.body).coordinates as [number, number][];
      // Richiesta A→B→C: fallisce. Singolarmente: A→B ok, B→C impossibile.
      if (pts.length === 3) return unroutable;
      if (pts[1]![0] === B[0]) return okResponse([A, B], [0, 1]);
      return unroutable;
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchOrsRouteLine([A, B, C], "hike", "key");
    expect(r).not.toBeNull();
    expect(r!.straight).toEqual([[B, C]]);
    expect(r!.feature.geometry.coordinates.at(-1)).toEqual(C);
  });

  it("non inventa linee rette per errori che non sono 'irraggiungibile' (quota, rete)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: { code: 2003, message: "Rate limit" } }) })));
    expect(await fetchOrsRouteLine([A, B], "hike", "key")).toBeNull();
  });

  it("tratteggia il collegamento se la tappa finale è lontana dalla via agganciata", async () => {
    const snapEnd: [number, number] = [11.01, 45.01]; // ≈1,1 km dalla tappa B
    vi.stubGlobal("fetch", vi.fn(async () => okResponse([A, snapEnd], [0, 1])));
    const r = await fetchOrsRouteLine([A, B], "hike", "key");
    expect(r!.straight).toEqual([[snapEnd, B]]);
    expect(r!.feature.geometry.coordinates.at(-1)).toEqual(B);
  });
});
