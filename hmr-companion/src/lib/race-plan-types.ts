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
