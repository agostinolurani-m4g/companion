import { SKI_TRACK_COLORS } from "@/lib/ski-overlays";

/** Tutte le attività supportate dall'app v2. */
export type UserRouteActivity =
  | "road"
  | "gravel"
  | "mtb"
  | "hike"
  | "trail_run"
  | "ski"
  | "snowshoe"
  | "nordic"
  | "ferrata"
  | "walk"
  | "run"
  | "ebike"
  | "bikepacking"
  | "alpinism";

export const USER_ROUTE_ACTIVITIES: readonly UserRouteActivity[] = [
  "road",
  "gravel",
  "mtb",
  "hike",
  "trail_run",
  "ski",
  "snowshoe",
  "nordic",
  "ferrata",
  "walk",
  "run",
  "ebike",
  "bikepacking",
  "alpinism",
] as const;

/** Lista per vincolo CHECK SQLite su user_routes.activity */
export const USER_ROUTE_ACTIVITY_CHECK_IN = USER_ROUTE_ACTIVITIES.map((a) => `'${a}'`).join(",");

export type SportSeason = "summer" | "winter" | "all";

export type MapOverlayId =
  | "slope"
  | "avalanche"
  | "opensnow"
  | "aspect"
  | "waymarked_cycling"
  | "waymarked_mtb"
  | "waymarked_hiking"
  | "road_surface"
  | "ferrata"
  | "sac_trails"
  | "contours"
  | "rainviewer";

export type ConditionWidgetId =
  | "weather_hourly"
  | "risk_semaphore"
  | "nearby_reports"
  | "daylight"
  | "avalanche_detail";

export type FieldReportKindRef =
  | "avalanche"
  | "cornice"
  | "ice"
  | "snow_conditions"
  | "rockfall"
  | "road_closed"
  | "road_damaged"
  | "trail_decommissioned"
  | "trail_blocked"
  | "bridge_down"
  | "water"
  | "storm"
  | "ferrata_damage"
  | "livestock_dogs"
  | "steep"
  | "other";

export type SportDefinition = {
  id: UserRouteActivity;
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  season: SportSeason;
  /** Profilo OpenRouteService (foot-hiking per sport senza routing ciclistico dedicato). */
  orsFootLike: boolean;
  usesCyclingOrs: boolean;
  /** Salita/discesa separata (scialpinismo). */
  skiTourMode: boolean;
  defaultOverlays: MapOverlayId[];
  relevantReportKinds: FieldReportKindRef[];
  conditionWidgets: ConditionWidgetId[];
  difficultyScale: string;
  plannerPath: string;
  exploreColor: string;
};

const BASE_REPORT: FieldReportKindRef[] = [
  "road_closed",
  "road_damaged",
  "trail_blocked",
  "trail_decommissioned",
  "water",
  "storm",
  "other",
];

export const SPORTS: Record<UserRouteActivity, SportDefinition> = {
  road: {
    id: "road",
    label: "Bici da strada",
    shortLabel: "Strada",
    icon: "🚴",
    color: "#ad9fdb",
    season: "summer",
    orsFootLike: false,
    usesCyclingOrs: true,
    skiTourMode: false,
    defaultOverlays: ["road_surface", "waymarked_cycling"],
    relevantReportKinds: [...BASE_REPORT, "livestock_dogs"],
    conditionWidgets: ["weather_hourly", "nearby_reports", "daylight"],
    difficultyScale: "—",
    plannerPath: "/v2/plan",
    exploreColor: "#ad9fdb",
  },
  gravel: {
    id: "gravel",
    label: "Gravel",
    shortLabel: "Gravel",
    icon: "🚵",
    color: "#ad9fdb",
    season: "summer",
    orsFootLike: false,
    usesCyclingOrs: true,
    skiTourMode: false,
    defaultOverlays: ["road_surface", "waymarked_cycling"],
    relevantReportKinds: [...BASE_REPORT],
    conditionWidgets: ["weather_hourly", "nearby_reports", "daylight"],
    difficultyScale: "—",
    plannerPath: "/v2/plan",
    exploreColor: "#ad9fdb",
  },
  mtb: {
    id: "mtb",
    label: "MTB",
    shortLabel: "MTB",
    icon: "🚵‍♂️",
    color: "#ad9fdb",
    season: "summer",
    orsFootLike: false,
    usesCyclingOrs: true,
    skiTourMode: false,
    defaultOverlays: ["waymarked_mtb", "road_surface"],
    relevantReportKinds: [...BASE_REPORT, "steep", "rockfall"],
    conditionWidgets: ["weather_hourly", "nearby_reports", "daylight"],
    difficultyScale: "mtb:scale",
    plannerPath: "/v2/plan",
    exploreColor: "#ad9fdb",
  },
  hike: {
    id: "hike",
    label: "Escursionismo",
    shortLabel: "Trekking",
    icon: "🥾",
    color: "#7fb8ae",
    season: "summer",
    orsFootLike: true,
    usesCyclingOrs: false,
    skiTourMode: false,
    defaultOverlays: ["waymarked_hiking", "sac_trails"],
    relevantReportKinds: [...BASE_REPORT, "steep", "rockfall", "livestock_dogs"],
    conditionWidgets: ["weather_hourly", "risk_semaphore", "nearby_reports", "daylight"],
    difficultyScale: "SAC T1–T6",
    plannerPath: "/v2/plan",
    exploreColor: "#7fb8ae",
  },
  trail_run: {
    id: "trail_run",
    label: "Trail running",
    shortLabel: "Trail",
    icon: "🏃",
    color: "#7fb8ae",
    season: "summer",
    orsFootLike: true,
    usesCyclingOrs: false,
    skiTourMode: false,
    defaultOverlays: ["waymarked_hiking", "sac_trails"],
    relevantReportKinds: [...BASE_REPORT, "steep", "storm"],
    conditionWidgets: ["weather_hourly", "risk_semaphore", "nearby_reports", "daylight"],
    difficultyScale: "SAC T1–T6",
    plannerPath: "/v2/plan",
    exploreColor: "#7fb8ae",
  },
  ski: {
    id: "ski",
    label: "Scialpinismo",
    shortLabel: "Sci",
    icon: "⛷️",
    color: "#9ebfd8",
    season: "winter",
    orsFootLike: true,
    usesCyclingOrs: false,
    skiTourMode: true,
    defaultOverlays: ["slope", "avalanche", "opensnow", "aspect"],
    relevantReportKinds: [
      "avalanche",
      "cornice",
      "ice",
      "snow_conditions",
      "rockfall",
      "storm",
      "trail_blocked",
      "other",
    ],
    conditionWidgets: [
      "weather_hourly",
      "risk_semaphore",
      "avalanche_detail",
      "nearby_reports",
      "daylight",
    ],
    difficultyScale: "Toponeige",
    plannerPath: "/v2/scialpinismo",
    exploreColor: "#9ebfd8",
  },
  snowshoe: {
    id: "snowshoe",
    label: "Ciaspole",
    shortLabel: "Ciaspole",
    icon: "🦶",
    color: "#9ebfd8",
    season: "winter",
    orsFootLike: true,
    usesCyclingOrs: false,
    skiTourMode: false,
    defaultOverlays: ["slope", "avalanche", "opensnow"],
    relevantReportKinds: [
      "avalanche",
      "snow_conditions",
      "ice",
      "storm",
      "trail_blocked",
      "other",
    ],
    conditionWidgets: [
      "weather_hourly",
      "risk_semaphore",
      "avalanche_detail",
      "nearby_reports",
      "daylight",
    ],
    difficultyScale: "WT1–WT6",
    plannerPath: "/v2/plan",
    exploreColor: "#9ebfd8",
  },
  nordic: {
    id: "nordic",
    label: "Sci di fondo",
    shortLabel: "Fondo",
    icon: "🎿",
    color: "#9ebfd8",
    season: "winter",
    orsFootLike: true,
    usesCyclingOrs: false,
    skiTourMode: false,
    defaultOverlays: ["opensnow", "avalanche"],
    relevantReportKinds: ["snow_conditions", "ice", "storm", "trail_blocked", "other"],
    conditionWidgets: ["weather_hourly", "avalanche_detail", "nearby_reports", "daylight"],
    difficultyScale: "—",
    plannerPath: "/v2/plan",
    exploreColor: "#9ebfd8",
  },
  ferrata: {
    id: "ferrata",
    label: "Vie ferrate",
    shortLabel: "Ferrata",
    icon: "🧗",
    color: "#cdb68f",
    season: "summer",
    orsFootLike: true,
    usesCyclingOrs: false,
    skiTourMode: false,
    defaultOverlays: ["ferrata", "sac_trails"],
    relevantReportKinds: [
      ...BASE_REPORT,
      "rockfall",
      "ferrata_damage",
      "storm",
      "steep",
    ],
    conditionWidgets: ["weather_hourly", "risk_semaphore", "nearby_reports", "daylight"],
    difficultyScale: "Hüsler K1–K6",
    plannerPath: "/v2/plan",
    exploreColor: "#cdb68f",
  },
  walk: {
    id: "walk",
    label: "Camminata",
    shortLabel: "Camminata",
    icon: "🚶",
    color: "#7fb8ae",
    season: "all",
    orsFootLike: true,
    usesCyclingOrs: false,
    skiTourMode: false,
    defaultOverlays: ["waymarked_hiking"],
    relevantReportKinds: [...BASE_REPORT, "livestock_dogs"],
    conditionWidgets: ["weather_hourly", "nearby_reports", "daylight"],
    difficultyScale: "—",
    plannerPath: "/v2/plan",
    exploreColor: "#7fb8ae",
  },
  run: {
    id: "run",
    label: "Corsa",
    shortLabel: "Corsa",
    icon: "👟",
    color: "#7fb8ae",
    season: "all",
    orsFootLike: true,
    usesCyclingOrs: false,
    skiTourMode: false,
    defaultOverlays: [],
    relevantReportKinds: [...BASE_REPORT],
    conditionWidgets: ["weather_hourly", "nearby_reports", "daylight"],
    difficultyScale: "—",
    plannerPath: "/v2/plan",
    exploreColor: "#7fb8ae",
  },
  ebike: {
    id: "ebike",
    label: "E-bike",
    shortLabel: "E-bike",
    icon: "⚡",
    color: "#ad9fdb",
    season: "summer",
    orsFootLike: false,
    usesCyclingOrs: true,
    skiTourMode: false,
    defaultOverlays: ["waymarked_cycling", "waymarked_mtb"],
    relevantReportKinds: [...BASE_REPORT, "steep"],
    conditionWidgets: ["weather_hourly", "nearby_reports", "daylight"],
    difficultyScale: "mtb:scale",
    plannerPath: "/v2/plan",
    exploreColor: "#ad9fdb",
  },
  bikepacking: {
    id: "bikepacking",
    label: "Bikepacking",
    shortLabel: "Bikepacking",
    icon: "🏕️",
    color: "#ad9fdb",
    season: "summer",
    orsFootLike: false,
    usesCyclingOrs: true,
    skiTourMode: false,
    defaultOverlays: ["waymarked_cycling"],
    relevantReportKinds: [...BASE_REPORT, "livestock_dogs"],
    conditionWidgets: ["weather_hourly", "nearby_reports", "daylight"],
    difficultyScale: "—",
    plannerPath: "/v2/plan",
    exploreColor: "#ad9fdb",
  },
  alpinism: {
    id: "alpinism",
    label: "Alpinismo",
    shortLabel: "Alpinismo",
    icon: "🏔️",
    color: "#cdb68f",
    season: "all",
    orsFootLike: true,
    usesCyclingOrs: false,
    skiTourMode: false,
    defaultOverlays: ["slope", "waymarked_hiking"],
    relevantReportKinds: [...BASE_REPORT, "rockfall", "ice", "cornice", "storm", "steep"],
    conditionWidgets: ["weather_hourly", "risk_semaphore", "nearby_reports", "daylight"],
    difficultyScale: "F–ED (IFAS)",
    plannerPath: "/v2/plan",
    exploreColor: "#cdb68f",
  },
};

export const PLANNER_ACTIVITIES: UserRouteActivity[] = [
  "hike",
  "walk",
  "trail_run",
  "run",
  "alpinism",
  "ferrata",
  "road",
  "gravel",
  "mtb",
  "ebike",
  "bikepacking",
  "snowshoe",
  "nordic",
];

export function isUserRouteActivity(raw: string): raw is UserRouteActivity {
  return (USER_ROUTE_ACTIVITIES as readonly string[]).includes(raw);
}

export function sportForActivity(activity: UserRouteActivity): SportDefinition {
  return SPORTS[activity];
}

export function activityLabel(activity: UserRouteActivity): string {
  return SPORTS[activity].label;
}

export function activityExploreColor(activity: UserRouteActivity): string {
  return SPORTS[activity].exploreColor;
}

export function emptyActivityCounts(): Record<UserRouteActivity, number> {
  const out = {} as Record<UserRouteActivity, number>;
  for (const id of USER_ROUTE_ACTIVITIES) out[id] = 0;
  return out;
}

export function exploreActivityOptions(): { value: UserRouteActivity | "all"; label: string }[] {
  return [
    { value: "all", label: "Tutti" },
    ...USER_ROUTE_ACTIVITIES.map((id) => ({
      value: id,
      label: SPORTS[id].shortLabel,
    })),
  ];
}

export function routeEditorHref(activity: UserRouteActivity, id: string): string {
  const sport = SPORTS[activity];
  if (sport.skiTourMode) {
    return `${sport.plannerPath}?route=${encodeURIComponent(id)}`;
  }
  return `/v2/plan?route=${encodeURIComponent(id)}&activity=${encodeURIComponent(activity)}`;
}

export function isWinterSport(activity: UserRouteActivity): boolean {
  return SPORTS[activity].season === "winter";
}

/** Blocchi condizioni da chiedere nel resoconto gita, per sport. */
export function outingConditionFields(
  activity: UserRouteActivity,
): ("snow" | "weather" | "access" | "trail")[] {
  if (isWinterSport(activity)) return ["snow", "weather", "access"];
  if (activity === "alpinism") return ["snow", "weather", "access", "trail"];
  return ["weather", "access", "trail"];
}

/** Pagina "Aggiungi gita": gita già fatta, da GPX e racconto, per qualsiasi sport. */
export function outingNewHref(activity?: UserRouteActivity | null, groupId?: string | null): string {
  const q = new URLSearchParams();
  if (activity) q.set("activity", activity);
  if (groupId) q.set("group", groupId);
  const qs = q.toString();
  return `/v2/gite/nuova${qs ? `?${qs}` : ""}`;
}

/** Planner del percorso con la tab "Gita" aperta (nuova gita o modifica di `outingId`). */
export function outingPlanHref(
  activity: UserRouteActivity,
  routeId: string,
  outingId?: string | null,
  groupId?: string | null,
): string {
  const base = routeEditorHref(activity, routeId);
  return `${base}&tab=outing${outingId ? `&outing=${encodeURIComponent(outingId)}` : ""}${
    groupId ? `&group=${encodeURIComponent(groupId)}` : ""
  }`;
}
