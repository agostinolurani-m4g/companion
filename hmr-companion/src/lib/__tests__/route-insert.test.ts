import { describe, expect, it } from "vitest";
import { insertIndexForPoint, minDetourInsertIndex, waypointRouteIndexes } from "@/lib/route-insert";

/** Linea densa tra due punti (passo ~100 m). */
function line(a: [number, number], b: [number, number], steps = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) out.push([a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]);
  return out;
}

describe("route-insert", () => {
  it("inserisce nel tratto dove il punto cade sul tracciato, non sulla retta tra tappe", () => {
    // Tappe A → B → C. Il tracciato A→B fa un largo giro a nord (a U), B→C è dritto.
    const A = { lng: 9.0, lat: 46.0 };
    const B = { lng: 9.02, lat: 46.0 };
    const C = { lng: 9.02, lat: 45.99 };
    const route = [
      ...line([9.0, 46.0], [9.0, 46.02]),
      ...line([9.0, 46.02], [9.02, 46.02]).slice(1),
      ...line([9.02, 46.02], [9.02, 46.0]).slice(1),
      ...line([9.02, 46.0], [9.02, 45.99]).slice(1),
    ];
    // Punto sulla parte nord del giro A→B: con la retta sarebbe "lontano da tutto".
    const p = { lng: 9.01, lat: 46.0201 };
    const r = insertIndexForPoint([A, B, C], p, route);
    expect(r.nearRoute).toBe(true);
    expect(r.index).toBe(1);
    // Punto sul tratto B→C.
    const q = { lng: 9.0201, lat: 45.995 };
    expect(insertIndexForPoint([A, B, C], q, route).index).toBe(2);
  });

  it("in un andata e ritorno non salta al passaggio di ritorno", () => {
    const A = { lng: 9.0, lat: 46.0 };
    const B = { lng: 9.02, lat: 46.0 };
    const route = [...line([9.0, 46.0], [9.02, 46.0]), ...line([9.02, 46.0], [9.0, 46.0]).slice(1)];
    const idx = waypointRouteIndexes(route, [A, B, A]);
    expect(idx).toEqual([0, 10, 20]);
  });

  it("punto lontano: deviazione minima", () => {
    const wps = [
      { lng: 9.0, lat: 46.0 },
      { lng: 9.1, lat: 46.0 },
      { lng: 9.2, lat: 46.0 },
    ];
    expect(minDetourInsertIndex(wps, { lng: 9.15, lat: 46.05 })).toBe(2);
    expect(minDetourInsertIndex(wps, { lng: 9.04, lat: 46.05 })).toBe(1);
    expect(insertIndexForPoint(wps, { lng: 9.15, lat: 46.05 }, null).index).toBe(2);
  });

  it("meno di due tappe: in coda", () => {
    expect(insertIndexForPoint([{ lng: 9, lat: 46 }], { lng: 9.1, lat: 46 }).index).toBe(1);
  });
});
