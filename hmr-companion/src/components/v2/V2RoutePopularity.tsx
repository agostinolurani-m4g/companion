"use client";

export type RoutePopularityDto = {
  community_pct: number;
  personal_pct: number | null;
  has_community_data: boolean;
  untrodden: [number, number][][];
};

export type RouteAlternativeDto = {
  coordinates: [number, number][];
  length_km: number;
  popularity: RoutePopularityDto | null;
};

/** GeoJSON dei tratti mai percorsi dalla community (per il layer tratteggiato). */
export function untroddenFeatureCollection(p: RoutePopularityDto | null): GeoJSON.FeatureCollection | null {
  if (!p || !p.has_community_data || p.untrodden.length === 0) return null;
  return {
    type: "FeatureCollection",
    features: p.untrodden.map((coords) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    })),
  };
}

function tone(pct: number): string {
  if (pct >= 75) return "var(--hmr-accent)";
  if (pct >= 40) return "#f59e0b";
  return "#f97316";
}

/**
 * Badge "quanto è battuto" + varianti più frequentate (dalla heatmap).
 * Le varianti arrivano da ORS solo con 2 tappe.
 */
export default function V2RoutePopularity({
  popularity,
  alternatives,
  currentLengthKm,
  onPickAlternative,
}: {
  popularity: RoutePopularityDto | null;
  alternatives: RouteAlternativeDto[];
  currentLengthKm: number;
  onPickAlternative: (alt: RouteAlternativeDto) => void;
}) {
  if (!popularity) return null;
  const current = popularity.community_pct;
  const better = alternatives.filter(
    (a) =>
      a.popularity &&
      a.popularity.community_pct >= current + 10 &&
      Math.abs(a.length_km - currentLengthKm) > 0.05,
  );

  return (
    <div className="mt-2 space-y-1.5 px-0.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {popularity.has_community_data ? (
          <span
            className="rounded-full px-2 py-0.5 font-semibold"
            style={{ color: tone(current), background: "color-mix(in srgb, currentColor 12%, transparent)" }}
            title="Quota del percorso su tratti già percorsi da altri utenti"
          >
            {current}% su tratti battuti dalla community
          </span>
        ) : (
          <span className="text-[color:var(--hmr-faint)]">Nessun dato community in questa zona</span>
        )}
        {popularity.personal_pct != null && popularity.personal_pct > 0 ? (
          <span className="rounded-full border border-[color:var(--hmr-border)] px-2 py-0.5 text-[color:var(--hmr-muted)]">
            {popularity.personal_pct}% già fatto da te
          </span>
        ) : null}
        {popularity.has_community_data && popularity.untrodden.length > 0 ? (
          <span className="text-[color:var(--hmr-muted)]">
            <span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-[#f97316] align-middle" />
            mai percorso
          </span>
        ) : null}
      </div>
      {better.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {better.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPickAlternative(a)}
              className="ui-chip !min-h-[28px] !px-2.5 !text-[11.5px]"
              title="Variante più frequentata secondo la heatmap"
            >
              Variante più battuta · {a.length_km.toFixed(1)} km · {a.popularity!.community_pct}%
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
