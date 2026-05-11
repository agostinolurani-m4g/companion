export type RacePlanItemKind = "note" | "sleep" | "stage" | "time" | "night_avoid";

export const RACE_PLAN_ITEM_KINDS: ReadonlyArray<RacePlanItemKind> = [
  "note",
  "sleep",
  "stage",
  "time",
  "night_avoid",
];

export function isRacePlanItemKind(s: string): s is RacePlanItemKind {
  return (RACE_PLAN_ITEM_KINDS as readonly string[]).includes(s);
}

export function labelRacePlanItemKind(k: RacePlanItemKind): string {
  switch (k) {
    case "note":
      return "Nota";
    case "sleep":
      return "Pernottamento";
    case "stage":
      return "Tappa";
    case "time":
      return "Tempi";
    case "night_avoid":
      return "Notte";
    default:
      return k;
  }
}
