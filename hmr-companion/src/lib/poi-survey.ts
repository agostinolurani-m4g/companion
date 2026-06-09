import type { PoiNoteStatus } from "./db";

/** `visited` legacy → trattato come verificato sul campo. */
export function normalizeSurveyStatus(status: PoiNoteStatus): PoiNoteStatus {
  return status === "visited" ? "info" : status;
}

export function isPoiSurveyVerified(status: PoiNoteStatus): boolean {
  return normalizeSurveyStatus(status) === "info";
}
