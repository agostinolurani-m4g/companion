/**
 * Affinità tra sport a livello di query: gli sport senza percorsi propri vedono anche quelli
 * di sport compatibili, senza duplicare righe nel DB.
 */
import type { UserRouteActivity } from "@/lib/sports";

/** Reti ciclabili OSM considerate «ciclovie» (EuroVelo, nazionali, regionali). */
export const CYCLE_NETWORKS = ["icn", "ncn", "rcn"] as const;

type Affinity = {
  /** Attività incluse per intero. */
  activities: UserRouteActivity[];
  /** Includi anche i percorsi `road` che appartengono a una ciclovia. */
  cycleNetworks?: boolean;
};

export const SPORT_AFFINITY: Partial<Record<UserRouteActivity, Affinity>> = {
  trail_run: { activities: ["hike", "walk"] },
  run: { activities: ["hike", "walk"] },
  ebike: { activities: ["mtb", "road"] },
  gravel: { activities: [], cycleNetworks: true },
  bikepacking: { activities: [], cycleNetworks: true },
};

/** Attività esatte da includere per un filtro (la richiesta per prima). */
export function activitiesForQuery(activity: UserRouteActivity): UserRouteActivity[] {
  const aff = SPORT_AFFINITY[activity];
  const out = [activity, ...(aff?.activities ?? [])];
  return [...new Set(out)];
}

/**
 * Frammento SQL (parametri nominati) per filtrare `user_routes` per sport con affinità.
 * `prefix` permette alias di tabella (es. "r.").
 */
export function activityFilterSql(
  activity: UserRouteActivity,
  prefix = "",
): { sql: string; params: Record<string, string> } {
  const acts = activitiesForQuery(activity);
  const params: Record<string, string> = {};
  const names = acts.map((a, i) => {
    params[`aff_a${i}`] = a;
    return `@aff_a${i}`;
  });
  let sql = `${prefix}activity IN (${names.join(", ")})`;
  if (SPORT_AFFINITY[activity]?.cycleNetworks) {
    const nets = CYCLE_NETWORKS.map((n) => `'${n}'`).join(", ");
    sql = `(${sql} OR (${prefix}activity = 'road' AND json_extract(${prefix}meta_json, '$.network') IN (${nets})))`;
  }
  return { sql, params };
}

/** true se il percorso è mostrato per affinità e non per sport esatto. */
export function isAffinityMatch(requested: UserRouteActivity | null, actual: UserRouteActivity): boolean {
  return requested != null && requested !== actual;
}
