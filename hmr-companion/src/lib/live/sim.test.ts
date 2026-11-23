import { describe, expect, it } from "vitest";
import {
  aroundMe,
  buildCourse,
  CHAT_RADIUS_M,
  createSim,
  ME_ID,
  positionAt,
  sendMyMessage,
  speedFromPower,
  step,
  visibleChat,
  type CoursePoint,
} from "./sim";

/** 20 km: 10 km in piano, poi 10 km al 6%. Un punto ogni 50 m, km cumulato come la traccia vera. */
function testCourse(): CoursePoint[] {
  const pts: CoursePoint[] = [];
  for (let i = 0; i <= 400; i++) {
    const km = i * 0.05;
    const ele = km <= 10 ? 100 : 100 + (km - 10) * 60;
    pts.push([21 + km / 85, 40, ele, km]);
  }
  return pts;
}

describe("modello fisico", () => {
  it("in piano a 200 W si va intorno ai 30 km/h, al 6% molto meno", () => {
    const flat = speedFromPower(200, 90, 0) * 3.6;
    const climb = speedFromPower(200, 90, 0.06) * 3.6;
    expect(flat).toBeGreaterThan(25);
    expect(flat).toBeLessThan(36);
    expect(climb).toBeGreaterThan(8);
    expect(climb).toBeLessThan(15);
  });

  it("più watt = più veloce, in discesa c'è un limite", () => {
    expect(speedFromPower(300, 90, 0.05)).toBeGreaterThan(speedFromPower(150, 90, 0.05));
    expect(speedFromPower(0, 90, -0.15) * 3.6).toBeLessThanOrEqual(65);
  });
});

describe("percorso", () => {
  it("usa il km cumulato e calcola la pendenza", () => {
    const c = buildCourse(testCourse());
    expect(c.lengthM).toBeCloseTo(20000, 0);
    expect(positionAt(c, 5000).grade).toBeCloseTo(0, 3);
    expect(positionAt(c, 15000).grade).toBeCloseTo(0.06, 2);
    expect(positionAt(c, 15000).ele).toBeCloseTo(400, 0);
  });
});

describe("simulazione", () => {
  const roster = { me: "ago", friends: ["ale", "gala"], groups: { "Amaro HMR": ["ago", "ale", "babbo"] }, others: 6, seed: 7 };

  it("classifica amici, gruppo e altri", () => {
    const s = createSim(buildCourse(testCourse()), roster);
    const byName = Object.fromEntries(s.riders.map((r) => [r.name, r]));
    expect(byName.ago.circle).toBe("me");
    expect(byName.ale.circle).toBe("friend");
    expect(byName.ale.groups).toEqual(["Amaro HMR"]);
    expect(byName.babbo.circle).toBe("group");
    expect(s.riders.filter((r) => r.circle === "other")).toHaveLength(6);
  });

  it("è deterministica con lo stesso seed", () => {
    const c = buildCourse(testCourse());
    const run = () => {
      const s = createSim(c, roster);
      for (let i = 0; i < 120; i++) step(s, c, { myWatts: 200, dt: 1 });
      return s.riders.map((r) => Math.round(r.distM));
    };
    expect(run()).toEqual(run());
  });

  it("chi spinge di più guadagna posizioni", () => {
    const c = buildCourse(testCourse());
    const slow = createSim(c, roster);
    const fast = createSim(c, roster);
    for (let i = 0; i < 600; i++) {
      step(slow, c, { myWatts: 100, dt: 1 });
      step(fast, c, { myWatts: 350, dt: 1 });
    }
    expect(aroundMe(fast).position).toBeLessThan(aroundMe(slow).position);
  });

  it("aroundMe: davanti ordinati dal più vicino, distacchi coerenti", () => {
    const c = buildCourse(testCourse());
    const s = createSim(c, roster);
    for (let i = 0; i < 30; i++) step(s, c, { myWatts: 200, dt: 1 });
    const { ahead, behind } = aroundMe(s);
    for (let i = 1; i < ahead.length; i++) expect(ahead[i].gapM).toBeGreaterThanOrEqual(ahead[i - 1].gapM);
    for (const a of ahead) expect(a.gapM).toBeGreaterThan(0);
    for (const b of behind) expect(b.gapM).toBeLessThanOrEqual(0);
    expect(aroundMe(s, "friends").total).toBe(3); // io + ale + gala
  });

  it("chat di prossimità: vedo solo chi è nel raggio, i vicini rispondono", () => {
    const c = buildCourse(testCourse());
    const s = createSim(c, { ...roster, others: 0 });
    const meR = s.riders.find((r) => r.id === ME_ID)!;
    const [near, far] = s.riders.filter((r) => r.id !== ME_ID);
    near.distM = meR.distM + 50;
    far.distM = meR.distM + CHAT_RADIUS_M + 500;
    s.chat.push(
      { id: "a", fromId: near.id, fromName: near.name, text: "vicino", t: 0, gapM: 50 },
      { id: "b", fromId: far.id, fromName: far.name, text: "lontano", t: 0, gapM: CHAT_RADIUS_M + 500 },
    );
    expect(visibleChat(s).map((m) => m.text)).toEqual(["vicino"]);

    const heard = sendMyMessage(s, "  ciao!  ");
    expect(heard).toBeGreaterThanOrEqual(1);
    expect(s.chat.at(-1)?.text).toBe("ciao!");
    expect(sendMyMessage(s, "   ")).toBe(0);
  });
});
