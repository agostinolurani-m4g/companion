import { describe, expect, it } from "vitest";
import { resampleLineByDistance } from "@/lib/elevation";

describe("resampleLineByDistance", () => {
  // ~1,11 km verso nord con soli 2 vertici (rettilineo) + un tratto fitto.
  const line: [number, number][] = [
    [10, 46],
    [10, 46.01],
    [10.0001, 46.01],
    [10.0002, 46.01],
  ];

  it("campiona a passo costante anche dove i vertici sono radi", () => {
    const { sampled, distanceKm } = resampleLineByDistance(line, 25);
    expect(sampled.length).toBeGreaterThan(40);
    expect(sampled[0]).toEqual(line[0]);
    expect(sampled.at(-1)).toEqual(line.at(-1));
    for (let i = 1; i < distanceKm.length - 1; i++) {
      expect(distanceKm[i]! - distanceKm[i - 1]!).toBeCloseTo(0.025, 6);
    }
  });

  it("mantiene la lunghezza vera della linea", () => {
    const { distanceKm } = resampleLineByDistance(line, 25);
    expect(distanceKm.at(-1)!).toBeCloseTo(1.112 + 0.0154, 2);
  });

  it("allarga il passo oltre il tetto di campioni", () => {
    const { sampled } = resampleLineByDistance(line, 25, 10);
    expect(sampled.length).toBeLessThanOrEqual(11);
  });
});
