import type { SafetyChecklistManual } from "@/lib/types";

export function parseSafetyChecklistJson(raw: string | null | undefined): SafetyChecklistManual {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    return o as SafetyChecklistManual;
  } catch {
    return {};
  }
}

export function stringifySafetyChecklistJson(m: SafetyChecklistManual): string | null {
  const keys = Object.keys(m);
  if (keys.length === 0) return null;
  return JSON.stringify(m);
}
