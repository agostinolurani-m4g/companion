/**
 * Eventi lato client emessi dai tool del planner (chat AI).
 * File separato da `claude-planner.ts` per import sicuri nel bundle client.
 */
export type MapPanelMode = "compact" | "expanded" | "hidden";

export type PlannerToolEvent =
  | { kind: "browser_url"; url: string; title?: string }
  | { kind: "draft_email"; to: string; subject: string; body: string }
  | { kind: "weather_overlay"; lat: number; lng: number; zoom: number }
  | { kind: "map_panel"; mode: MapPanelMode };
