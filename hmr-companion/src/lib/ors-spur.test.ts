import { describe, expect, it } from "vitest";
import { trimSpurs, type OrsLeg } from "@/lib/openrouteservice-route";

// ~111 m per 0.001° di latitudine.
const line = (lats: number[]): [number, number][] => lats.map((lat) => [11, lat]);

describe("trimSpurs", () => {
  it("toglie l'andata e ritorno sulla stessa via", () => {
    // A→B sale fino a 0.006 (≈670 m oltre il bivio a 0.002); B→C torna indietro e prosegue altrove.
    const a: OrsLeg = { coords: line([0, 0.001, 0.002, 0.003, 0.004, 0.005, 0.006]) };
    const b: OrsLeg = {
      coords: [...line([0.006, 0.005, 0.004, 0.003, 0.002]), [11.001, 0.002], [11.002, 0.002]] as [number, number][],
    };
    const r = trimSpurs([a, b]);
    expect(r.spurs).toHaveLength(1);
    expect(r.spurs[0]!.waypoint).toBe(1);
    expect(r.legs[0]!.coords.at(-1)).toEqual([11, 0.002]);
    expect(r.legs[1]!.coords[0]).toEqual([11, 0.002]);
    expect(r.legs[1]!.coords.at(-1)).toEqual([11.002, 0.002]);
  });

  it("lascia stare le punte corte", () => {
    const a: OrsLeg = { coords: line([0, 0.001, 0.002]) };
    const b: OrsLeg = { coords: [...line([0.002, 0.001]), [11.001, 0.001]] as [number, number][] };
    expect(trimSpurs([a, b]).spurs).toHaveLength(0);
  });

  it("non tocca percorsi che proseguono dritti", () => {
    const a: OrsLeg = { coords: line([0, 0.002, 0.004]) };
    const b: OrsLeg = { coords: line([0.004, 0.006, 0.008]) };
    const r = trimSpurs([a, b]);
    expect(r.spurs).toHaveLength(0);
    expect(r.legs[1]!.coords).toHaveLength(3);
  });
});
