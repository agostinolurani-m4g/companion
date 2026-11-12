const SAC_COLORS: Record<string, string> = {
  hiking: "#22c55e",
  mountain_hiking: "#84cc16",
  demanding_mountain_hiking: "#eab308",
  alpine_hiking: "#f97316",
  demanding_alpine_hiking: "#ef4444",
  difficult_alpine_hiking: "#7f1d1d",
};

const MTB_COLORS = ["#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#14532d"];

export function trailLineColor(tags: Record<string, string>, kind: string): string {
  if (kind === "trail_abandoned" || kind === "trail_disused" || kind === "access_no") return "#ef4444";
  if (kind === "seasonal_closed") return "#fb923c";
  if (kind === "via_ferrata") {
    const scale = tags["via_ferrata_scale"] ?? "2";
    const n = Math.min(5, Math.max(0, Number.parseInt(scale, 10) || 2));
    return `hsl(${300 - n * 20}, 70%, 55%)`;
  }
  const sac = tags.sac_scale;
  if (sac && SAC_COLORS[sac]) return SAC_COLORS[sac];
  const mtb = tags["mtb:scale"];
  if (mtb) {
    const idx = Math.min(MTB_COLORS.length - 1, Math.max(0, Number.parseInt(mtb, 10) || 0));
    return MTB_COLORS[idx];
  }
  const piste = tags["piste:difficulty"];
  if (piste === "novice" || piste === "easy") return "#38bdf8";
  if (piste === "intermediate") return "#ef4444";
  if (piste === "advanced" || piste === "expert") return "#1e293b";
  return "#fbbf24";
}
